-- ════════════════════════════════════════════════════════════════════════════
-- Table & field permissions — STAGE 2 of 3: WRITES.
--
-- Stage 1 landed the machinery wired to nothing. This wires it up, in the ONE
-- place that covers every caller.
--
-- ── Why a trigger, and not RLS ──
--
-- A rule expressed as an RLS policy is enforced for cookie sessions and
-- SILENTLY NOT for anything else, because every swamp_api_* and swamp_shared_*
-- function is SECURITY DEFINER and runs as owner with RLS off. That is the worst
-- failure mode available: it looks enforced.
--
-- A BEFORE trigger has none of that problem. It fires for every INSERT and
-- UPDATE on public.records regardless of the caller's security context — RLS on
-- or off, definer or invoker, service role or anon. And records.data is the only
-- place a field value lives, so ONE trigger is a complete choke point for:
--
--   · PostgREST inserts/updates from the session client (repo.ts)
--   · swamp_patch_records (granted to `authenticated`, callable directly as RPC)
--   · swamp_api_insert / swamp_api_patch / swamp_api_upsert / swamp_api_delete
--   · swamp_submit_form (anon, public forms)
--   · the ingest route, the importer, the upsert service
--   · swamp_duplicate_table / swamp_duplicate_base
--
-- Six guards in six callers would leave the seventh unwritten. This is one.
--
-- ── What it costs when nobody uses it ──
--
-- One boolean read off the row's base. `bases.has_permissions` is maintained by
-- the Stage-1 trigger, so a base with no rules returns before touching the
-- permissions table at all.
--
-- ── Stated ceilings (real, and deliberately not papered over) ──
--
-- · The SERVICE ROLE is exempt. The Sheets cron and the webhook dispatcher run
--   with no user identity at all (swamp_actor() is NULL), and denying them would
--   break every sync the moment one unrelated field got a rule. They are gated
--   by CRON_SECRET and are the system, not a person. `ponytail: service_role is
--   exempt; if a rule must bind the cron too, the cron needs to carry an actor.`
--
-- · LINK fields cannot be covered. A link's value lives in public.links, not in
--   records.data, so this trigger never sees it — and lookup/rollup/count are
--   computed, never stored. A record_field_edit rule on a link field is refused
--   at write time (below) rather than accepted and ignored.
--
-- · sort_order is not a field. Reordering rows in a table whose fields are all
--   locked is still possible; that is a move, not an edit.
-- ════════════════════════════════════════════════════════════════════════════

-- A rule on a field whose value does not live in records.data could never be
-- enforced by the trigger below. Refuse it at write time instead of accepting a
-- rule that silently does nothing — the same reasoning that kept
-- table_visibility out of the key list in Stage 1.
create or replace function public.swamp_permission_field_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if new.key <> 'record_field_edit' then
    return new;
  end if;

  select f.type::text into v_type
    from public.fields f
   where f.id = new.field_id and f.deleted_at is null;

  if v_type is null then
    raise exception 'swamp: no such field' using errcode = '42P01';
  end if;

  -- Computed and relational values are not stored in records.data, so no write
  -- guard can see them. Read-only field types cannot be edited by anyone
  -- already, which makes a rule on them meaningless rather than dangerous.
  if v_type in ('link', 'lookup', 'rollup', 'formula', 'count', 'button',
                'barcode', 'qr', 'autoNumber',
                'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy') then
    raise exception
      'swamp: % fields hold no stored value, so an edit rule on them could not be enforced', v_type
      using errcode = '22023';
  end if;

  return new;
end
$$;

create trigger permissions_field_guard
  before insert or update on public.permissions
  for each row execute function public.swamp_permission_field_guard();

-- ─── The choke point ────────────────────────────────────────────────────────

create or replace function public.swamp_enforce_record_permissions()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor   uuid;
  v_flag    boolean;
  v_key     text;
  v_field   record;
begin
  -- Fast path: one boolean. 99% of bases stop here.
  select b.has_permissions into v_flag
    from public.bases b where b.id = new.base_id;

  if v_flag is not true then
    return new;
  end if;

  -- The system is not a person. See the header.
  if current_user = 'service_role' then
    return new;
  end if;

  -- swamp_actor() resolves a cookie session (auth.uid()) OR an API token (the
  -- `swamp.actor` GUC that swamp_api_require sets). Using auth.uid() directly
  -- here would make every token write anonymous, and therefore denied.
  v_actor := public.swamp_actor();

  -- ── Add / delete / restore ──
  if tg_op = 'INSERT' then
    if not public.swamp_permission_allows(
         new.base_id, new.table_id, 'table_record_add', null, v_actor) then
      raise exception 'swamp: you may not add records to this table'
        using errcode = '42501';
    end if;

  elsif tg_op = 'UPDATE' then
    -- A soft delete and its UNDO are the same permission. Guarding only
    -- null → timestamp would leave restore wide open, which is the same door.
    if (old.deleted_at is null) <> (new.deleted_at is null) then
      if not public.swamp_permission_allows(
           new.base_id, new.table_id, 'table_record_delete', null, v_actor) then
        raise exception 'swamp: you may not delete or restore records in this table'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- ── Field edits ──
  --
  -- Only keys whose value actually CHANGED, and only fields that carry a rule.
  -- Comparing against old.data is what keeps a read-modify-write of the whole
  -- row (which is what PostgREST and swamp_patch_records both do) from tripping
  -- on fields the caller never touched.
  if tg_op = 'INSERT' or new.data is distinct from old.data then
    for v_field in
      select f.id, f.key
        from public.fields f
       where f.table_id = new.table_id
         and f.deleted_at is null
         and exists (
           select 1 from public.permissions p
            where p.table_id = new.table_id
              and p.key = 'record_field_edit'
              and p.field_id = f.id
         )
    loop
      v_key := v_field.key;

      if tg_op = 'INSERT' then
        -- On insert, "changed" means the caller supplied the key at all. A key
        -- absent from the payload is not an edit.
        continue when not (new.data ? v_key);
      else
        continue when (old.data -> v_key) is not distinct from (new.data -> v_key);
      end if;

      if not public.swamp_permission_allows(
           new.base_id, new.table_id, 'record_field_edit', v_field.id, v_actor) then
        raise exception 'swamp: you may not edit "%" on this table',
          (select f2.name from public.fields f2 where f2.id = v_field.id)
          using errcode = '42501';
      end if;
    end loop;
  end if;

  return new;
end
$$;

-- Named to sort AFTER records_auto_number so a server-assigned autoNumber is
-- already in `new.data` — irrelevant today (autoNumber is read-only and so
-- cannot carry a rule) but stable if that ever changes. Postgres fires per-row
-- triggers alphabetically within a timing.
create trigger records_permissions
  before insert or update on public.records
  for each row execute function public.swamp_enforce_record_permissions();

-- ─── The early, friendly error on the token path ────────────────────────────
--
-- The trigger is what makes this CORRECT; swamp_pick_writable is what makes it
-- POLITE. It already drops keys a token may not write (computed fields, unknown
-- keys); teaching it about field rules means the API answers "you may not edit
-- X" at the top of the call instead of surfacing a trigger exception from the
-- bottom of one. Correctness does not depend on this staying in step — if it
-- drifts, the trigger still refuses.

create or replace function public.swamp_writable_keys(p_table_id uuid)
returns text[]
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(f.key), '{}'::text[])
    from public.fields f
   where f.table_id = p_table_id
     and f.deleted_at is null
     and f.type not in ('link','lookup','rollup','formula','count','button',
                        'barcode','qr','autoNumber',
                        'createdTime','modifiedTime','createdBy','modifiedBy')
     -- Fields the CURRENT actor may not edit are not writable keys for them.
     -- swamp_actor() covers session and token alike.
     and public.swamp_permission_allows(
           f.base_id, p_table_id, 'record_field_edit', f.id, public.swamp_actor())
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- `create or replace` keeps swamp_writable_keys' existing ACL. The two new
-- trigger functions are reached only through their triggers (which run at
-- CREATE TRIGGER authority), so they need no grant — but the default PUBLIC
-- grant is stripped so the anon-surface check stays clean.

revoke all on function public.swamp_enforce_record_permissions() from public, anon;
revoke all on function public.swamp_permission_field_guard() from public, anon;
