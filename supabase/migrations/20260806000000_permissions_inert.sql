-- ════════════════════════════════════════════════════════════════════════════
-- Table & field permissions — STAGE 1 of 4: INERT.
--
-- This migration adds the table, the resolver and the fast-path flag, and wires
-- them to NOTHING. After it lands, every existing behaviour is byte-identical
-- and the whole integration suite must pass unchanged. That is the point: the
-- staging exists so the scary part (Stage 3, writes) arrives on machinery that
-- has already been proven inert.
--
--   Stage 1 (this file) — table + resolver + flag, no call sites
--   Stage 2 — READ: table visibility, field-read via the p_only allow-list
--   Stage 3 — WRITE: a records trigger + the swamp_api_* definer bodies
--   Stage 4 — the UI
--
-- ── What this models, and what it does NOT ──
--
-- NocoDB's PermissionKey set, verbatim: TABLE_VISIBILITY, TABLE_RECORD_ADD,
-- TABLE_RECORD_DELETE, RECORD_FIELD_EDIT. All four are TABLE- or FIELD-scoped.
-- None of them is a row predicate — "only show Alice rows where owner = Alice"
-- is a different, much larger feature (a filter tree per role, ANDed into every
-- read) and is deliberately not smuggled in here.
--
-- ── Three rules this file exists to make impossible to get wrong ──
--
-- 1. A permission may only ever NARROW. Every future call site reads
--
--        swamp_can(base_id, <min role>) AND swamp_permission_allows(...)
--
--    never OR. A rule cannot hand someone access the role ladder denies them;
--    it can only take away. There is a test for this.
--
-- 2. Default-OPEN. The resolver returns TRUE when no rule exists. That is what
--    lets Stage 2 and 3 wire up call sites without changing anyone's behaviour
--    until a human writes a rule.
--
-- 3. SECURITY DEFINER bypasses RLS. Every swamp_api_* and swamp_shared_* runs
--    as owner, so a rule expressed ONLY as an RLS policy would be enforced for
--    cookie sessions and silently NOT for API tokens — the worst failure mode
--    available, because it looks enforced. The resolver is therefore a FUNCTION
--    called from both the policies and the definer bodies, never a policy alone.
--
-- ── Why bases.has_permissions exists ──
--
-- Without it, every row read in the product pays a `permissions` lookup forever
-- for a feature 99% of bases will never use. The flag is maintained by trigger,
-- so every hot call site can read
--
--        swamp_can(...) and (not <flag> or swamp_permission_allows(...))
--
-- and a base with no rules short-circuits before touching the table at all.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── The rules ──────────────────────────────────────────────────────────────

create table public.permissions (
  id         uuid primary key default gen_random_uuid(),

  -- Denormalised, like every other domain table: the RLS policy reads it
  -- directly instead of joining back to tables → bases.
  base_id    uuid not null references public.bases(id) on delete cascade,
  table_id   uuid not null references public.tables(id) on delete cascade,

  -- Only RECORD_FIELD_EDIT is field-scoped. The other three are table-wide, and
  -- the CHECK below refuses the nonsensical combinations rather than letting a
  -- field_id sit unread on a table rule.
  field_id   uuid references public.fields(id) on delete cascade,

  -- ── Three keys, not NocoDB's four. TABLE_VISIBILITY is deliberately absent ──
  --
  -- All three below are WRITE permissions, and writes have a real choke point:
  -- every path that changes a record — session PostgREST, swamp_patch_records,
  -- every swamp_api_*, the ingest route, form submission, the importer — reaches
  -- records.data through an INSERT or UPDATE on public.records, and a trigger
  -- fires regardless of SECURITY DEFINER and regardless of RLS. One guard covers
  -- all of them (Stage 3).
  --
  -- TABLE_VISIBILITY is a READ permission and has no such choke point. An audit
  -- of the read surface found ~15 paths that bypass the p_only field allow-list
  -- (swamp_aggregate takes no p_only at all; swamp_api_get and
  -- swamp_computed_values pass NULL; /trash and /records/[id]/history read
  -- records.data and the audit diff directly; webhook deliveries ship the whole
  -- row to a third party; swamp_duplicate_table copies rows into a table with no
  -- rules; the Sheets cron runs on the service role with RLS off). And a
  -- predicate on public.tables alone hides only the NAME — records, fields,
  -- views, filters, links and comments are all reachable by their own ids.
  --
  -- A permission that appears in the UI and silently fails to hold is worse than
  -- one that is absent, so the key is not offered until the read surface has a
  -- choke point of its own. See docs/GUIDE.md.
  key        text not null check (key in (
    'table_record_add',
    'table_record_delete',
    'record_field_edit'
  )),

  -- role   → everyone at this rung and above (and still capped by the ladder)
  -- user   → exactly the listed people
  -- nobody → no one, including owners. The "locked column" case.
  granted_type text not null check (granted_type in ('role', 'user', 'nobody')),
  role         public.swamp_role,
  user_ids     uuid[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint permissions_field_scope check (
    (key = 'record_field_edit' and field_id is not null)
    or (key <> 'record_field_edit' and field_id is null)
  ),

  -- A rule must actually say something.
  --
  -- NOTE the coalesce. `array_length('{}', 1)` is NULL, not 0, and a CHECK
  -- PASSES on NULL — so the obvious `array_length(user_ids, 1) >= 1` admits the
  -- empty array it was written to refuse. (Same trap as the webhook url check in
  -- 20260805010000: a NULL-valued CHECK is a CHECK that isn't there.)
  constraint permissions_grant_shape check (
    (granted_type = 'role'   and role is not null)
    or (granted_type = 'user' and coalesce(array_length(user_ids, 1), 0) >= 1)
    or (granted_type = 'nobody')
  )
);

-- One rule per target. Two rules for the same thing would need a precedence
-- story, and "whichever the planner returned first" is not a story.
create unique index permissions_target_uniq
  on public.permissions (table_id, key, coalesce(field_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index permissions_lookup_idx on public.permissions (table_id, key);

create trigger permissions_touch before update on public.permissions
  for each row execute function public.swamp_touch_updated_at();

alter table public.permissions enable row level security;

-- Reading the rules is viewer-level: the UI has to grey out what you cannot do,
-- and a rule is not itself sensitive. WRITING them is creator work, the same
-- rung that owns schema.
create policy "permissions: read" on public.permissions
  for select using (public.swamp_can(base_id, 'viewer'));

create policy "permissions: creator write" on public.permissions
  for all using (public.swamp_can(base_id, 'creator'))
  with check (public.swamp_can(base_id, 'creator'));

-- New tables arrive with PostgREST's default anon grants; anon has no business
-- here (the anon-surface test enforces exactly this).
revoke all on table public.permissions from anon;

-- ─── The fast path ──────────────────────────────────────────────────────────

alter table public.bases
  add column has_permissions boolean not null default false;

create or replace function public.swamp_sync_has_permissions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base uuid := coalesce(new.base_id, old.base_id);
begin
  update public.bases b
     set has_permissions = exists (
       select 1 from public.permissions p where p.base_id = v_base
     )
   where b.id = v_base;
  return null;   -- AFTER trigger; the return value is ignored
end
$$;

create trigger permissions_sync_flag
  after insert or update or delete on public.permissions
  for each row execute function public.swamp_sync_has_permissions();

-- ─── The resolver ───────────────────────────────────────────────────────────
--
-- SECURITY DEFINER for two reasons, both load-bearing:
--
--   1. It is called from `permissions`' OWN policy path in later stages, and an
--      invoker function reading the table it gates is the RLS recursion trap
--      swamp_workspace_role's comment documents.
--   2. It is called from inside other definer functions (swamp_api_*), which
--      run as owner with no auth.uid() — it must not depend on the caller's
--      privileges to read a rule.
--
-- Returns TRUE when no rule exists. Default-open is what makes this shippable
-- in stages; a default-closed resolver would lock every base the moment Stage 2
-- wired up its first call site.

create or replace function public.swamp_permission_allows(
  p_base_id  uuid,
  p_table_id uuid,
  p_key      text,
  p_field_id uuid,
  p_user_id  uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.permissions;
begin
  select * into v_rule
    from public.permissions
   where table_id = p_table_id
     and key = p_key
     and field_id is not distinct from p_field_id;

  -- No rule: the role ladder alone decides. This is the 99% case.
  if v_rule.id is null then
    return true;
  end if;

  -- An unauthenticated caller can never satisfy a rule. Note this is reached
  -- only when a rule EXISTS — public form submission and shared reads stay
  -- governed by their own allow-lists.
  if p_user_id is null then
    return false;
  end if;

  case v_rule.granted_type
    when 'nobody' then
      return false;

    when 'user' then
      return p_user_id = any(v_rule.user_ids);

    when 'role' then
      -- The rule names a MINIMUM rung. Because every call site ANDs this with
      -- swamp_can(base, <ladder minimum>), naming a lower rung here can only
      -- ever be a no-op — it cannot widen.
      return public.swamp_role_rank(public.swamp_base_role_of(p_base_id, p_user_id))
             >= public.swamp_role_rank(v_rule.role);

    else
      -- An unknown granted_type should be unreachable (CHECK constraint), but
      -- if one ever appears, deny. A permission system that fails open on an
      -- unrecognised value is not a permission system.
      return false;
  end case;
end
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- Called from RLS policies (as the session user) and from inside SECURITY
-- DEFINER bodies (as owner). It needs NO anon grant: the definer functions that
-- anon reaches run as owner, and the anon_grants migration documents that inner
-- callees of a definer function do not need their own grant.

revoke all on function public.swamp_permission_allows(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.swamp_permission_allows(uuid, uuid, text, uuid, uuid) to authenticated, service_role;

revoke all on function public.swamp_sync_has_permissions() from public, anon;
