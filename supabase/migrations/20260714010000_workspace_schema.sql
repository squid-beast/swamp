-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1a — the relational spine.
--
--   workspace → base → table → { field, view, record }
--                                 view → { view_field, filter, sort }
--                                 record ←→ record  (links)
--
-- This is additive. The old `datasets` / `dataset_rows` tables are untouched and
-- the app keeps running on them until Phase 1c cuts over; a later migration
-- drops them. See docs/SPEC.md and docs/ROADMAP.md.
--
-- Three decisions are load-bearing here. If you change one, read the spec first:
--
--   1. Records are rows in ONE table with a JSONB payload — not a generated
--      Postgres table per user table. One RLS policy instead of N, no runtime
--      DDL, no migration engine of our own. The price is that filters and sorts
--      MUST compile to SQL (Phase 1b) rather than being applied in JS.
--
--   2. `sort_order` is NUMERIC, not int. Fractional indexing: to move a row
--      between two neighbours, write (before + after) / 2 — one UPDATE, no
--      reindexing of siblings, no lock contention. An int column makes row
--      reordering literally unimplementable, which is the bug the old
--      dataset_rows.ord has today.
--
--   3. `base_id` is DENORMALIZED onto every table. RLS reads it directly. The
--      old dataset_rows policy ran an EXISTS subquery against the parent on
--      EVERY ROW — fine at 5k, a disaster at 500k.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Enums ──────────────────────────────────────────────────────────────────

-- The role ladder. Each role inherits everything below it.
-- The load-bearing line is editor → creator: editors change DATA and VIEWS,
-- creators change SCHEMA.
create type public.swamp_role as enum (
  'viewer',     -- read records, comments, history; export
  'commenter',  -- + comment
  'editor',     -- + write records; change filters/sorts/fields on a view
  'creator',    -- + create/alter/drop tables and fields; manage webhooks, share
  'owner'       -- + delete the base; billing
);

create type public.swamp_field_type as enum (
  -- scalars (these are the 23 the inference engine already produces)
  'text', 'longText', 'number', 'currency', 'percent', 'rating', 'boolean',
  'date', 'datetime', 'time', 'duration', 'year', 'email', 'phone', 'url',
  'image', 'color', 'uuid', 'coordinates', 'singleSelect', 'multiSelect',
  'status', 'json',
  -- data types we were missing
  'attachment', 'user',
  -- relational / computed — these have NO value in records.data; they are
  -- resolved at query time from `links` or compiled into the SELECT
  'link', 'lookup', 'rollup', 'formula', 'count',
  -- projections and actions
  'button', 'barcode', 'qr',
  -- auto-maintained, read-only
  'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy'
);

create type public.swamp_view_type as enum (
  'grid', 'gallery', 'kanban', 'form', 'calendar'
);

-- Two-dimensional permission check (see docs/SPEC.md §7):
--   canEditViewConfig = role >= editor
--                    && lock_type <> 'locked'
--                    && (lock_type <> 'personal' || owner_id = me)
create type public.swamp_view_lock as enum (
  'collaborative',  -- any editor+ can change the view config
  'locked',         -- nobody can, until unlocked. Data editing still works.
  'personal'        -- only owner_id can. Others may open it read-only.
);


-- ─── Role helpers ───────────────────────────────────────────────────────────

create function public.swamp_role_rank(r public.swamp_role)
returns int
language sql immutable parallel safe
as $$
  select case r
    when 'viewer'    then 1
    when 'commenter' then 2
    when 'editor'    then 3
    when 'creator'   then 4
    when 'owner'     then 5
  end
$$;


-- ─── Workspaces ─────────────────────────────────────────────────────────────

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,

  -- Exists for RLS, not for display. See the note on swamp_base_role_in: the
  -- membership row that makes you the owner is written by an AFTER trigger, so
  -- on `insert into workspaces ... returning *` the SELECT policy runs BEFORE
  -- that row exists and would deny you your own workspace. This column is on the
  -- new row itself, so the policy can read it without reading anything else.
  created_by uuid references auth.users(id) on delete set null default auth.uid(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.swamp_role not null default 'editor',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

-- SECURITY DEFINER on purpose: this reads workspace_members, and it is *called
-- from* workspace_members' own RLS policy. Without DEFINER (which bypasses RLS)
-- that is infinite recursion.
create function public.swamp_workspace_role(p_workspace_id uuid)
returns public.swamp_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select wm.role
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id
     and wm.user_id = auth.uid()
$$;

create function public.swamp_workspace_can(p_workspace_id uuid, p_min public.swamp_role)
returns boolean
language sql stable
as $$
  select coalesce(
    public.swamp_role_rank(public.swamp_workspace_role(p_workspace_id))
      >= public.swamp_role_rank(p_min),
    false
  )
$$;


-- ─── Bases ──────────────────────────────────────────────────────────────────

create table public.bases (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  icon         text,
  color        text,
  sort_order   numeric not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index bases_workspace_idx on public.bases (workspace_id, sort_order)
  where deleted_at is null;

-- A per-base role OVERRIDES the workspace role. Absent a row here, you get
-- whatever the workspace grants you.
create table public.base_members (
  base_id    uuid not null references public.bases(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.swamp_role not null,
  created_at timestamptz not null default now(),
  primary key (base_id, user_id)
);

create index base_members_user_idx on public.base_members (user_id);

-- A per-base override, if there is one. Reads base_members and NOTHING else.
create function public.swamp_base_member_role(p_base_id uuid)
returns public.swamp_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select bm.role
    from public.base_members bm
   where bm.base_id = p_base_id
     and bm.user_id = auth.uid()
$$;

-- ── The self-reference trap ──────────────────────────────────────────────────
--
-- `bases` RLS must NEVER read `bases`.
--
-- Consider `insert into bases (...) returning *` — which is what every ORM and
-- PostgREST does. Postgres applies the SELECT policy to the row being returned.
-- If that policy resolves the user's role by joining `bases` to find the
-- workspace, it is looking for a row inserted by THIS VERY STATEMENT — which is
-- not visible to the statement's own snapshot. The policy cannot see the row it
-- is being asked to check, so it denies, and you get:
--
--     new row violates row-level security policy for table "bases"
--
-- ...on a base the user is entirely entitled to create. Maddening, and it only
-- shows up on INSERT ... RETURNING, never on a plain read.
--
-- So: this variant takes workspace_id as an ARGUMENT. The `bases` policies pass
-- the row's own workspace_id column, which is available to the policy expression
-- without reading anything. No self-reference, no snapshot problem.
create function public.swamp_base_role_in(p_base_id uuid, p_workspace_id uuid)
returns public.swamp_role
language sql stable
as $$
  select coalesce(
    public.swamp_base_member_role(p_base_id),
    public.swamp_workspace_role(p_workspace_id)
  )
$$;

create function public.swamp_can_in(
  p_base_id uuid,
  p_workspace_id uuid,
  p_min public.swamp_role
)
returns boolean
language sql stable
as $$
  select coalesce(
    public.swamp_role_rank(public.swamp_base_role_in(p_base_id, p_workspace_id))
      >= public.swamp_role_rank(p_min),
    false
  )
$$;

-- The one function every OTHER table's RLS goes through. Safe for them: by the
-- time you are inserting a table/field/record, its base already exists and is
-- visible. Only `bases` itself has the problem above.
create function public.swamp_base_role(p_base_id uuid)
returns public.swamp_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.swamp_base_member_role(p_base_id),
    (select public.swamp_workspace_role(b.workspace_id)
       from public.bases b
      where b.id = p_base_id)
  )
$$;

create function public.swamp_can(p_base_id uuid, p_min public.swamp_role)
returns boolean
language sql stable
as $$
  select coalesce(
    public.swamp_role_rank(public.swamp_base_role(p_base_id))
      >= public.swamp_role_rank(p_min),
    false
  )
$$;


-- ─── Tables ─────────────────────────────────────────────────────────────────

create table public.tables (
  id         uuid primary key default gen_random_uuid(),
  base_id    uuid not null references public.bases(id) on delete cascade,
  name       text not null,
  icon       text,
  sort_order numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index tables_base_idx on public.tables (base_id, sort_order)
  where deleted_at is null;


-- ─── Fields ─────────────────────────────────────────────────────────────────

create table public.fields (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.tables(id) on delete cascade,
  base_id    uuid not null references public.bases(id) on delete cascade,

  -- Every field has TWO names, and conflating them is the bug that eats a week:
  --   name — what the user sees. Renameable at will.
  --   key  — the key into records.data. NEVER changes.
  -- Nothing downstream (formula, filter, view config) may reference a field by
  -- its display name.
  name       text not null,
  key        text not null,

  type       public.swamp_field_type not null default 'text',

  -- Per-type config. Shapes, by type:
  --   singleSelect/multiSelect/status  { options: [{value, color}] }
  --   currency                         { currency, precision }
  --   link      { targetTableId, cardinality: 'one'|'many', symmetricFieldId }
  --   lookup    { linkFieldId, targetFieldId }
  --   rollup    { linkFieldId, targetFieldId, fn }
  --   formula   { expr, exprRaw, ast, error }
  --      expr    — canonical, field IDs. A rename must not break a formula.
  --      exprRaw — what the user typed, with names. Display only.
  options    jsonb not null default '{}'::jsonb,

  -- The display value: what other tables show when they reference this record.
  is_primary boolean not null default false,

  sort_order numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index fields_table_idx on public.fields (table_id, sort_order)
  where deleted_at is null;

create unique index fields_table_key_uniq on public.fields (table_id, key)
  where deleted_at is null;

-- Exactly one primary field per table.
create unique index fields_one_primary on public.fields (table_id)
  where is_primary and deleted_at is null;


-- ─── Views ──────────────────────────────────────────────────────────────────

create table public.views (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.tables(id) on delete cascade,
  base_id    uuid not null references public.bases(id) on delete cascade,
  type       public.swamp_view_type not null default 'grid',
  name       text not null,

  -- Every table has exactly one, and it cannot be deleted.
  is_default boolean not null default false,

  lock_type  public.swamp_view_lock not null default 'collaborative',
  owner_id   uuid references auth.users(id) on delete set null,

  -- Per-type config:
  --   grid     { rowHeight }
  --   gallery  { coverFieldId }
  --   kanban   { stackFieldId, stacks: [{ id, title, order, collapsed, color }] }
  --   form     { heading, successMsg, redirectUrl, ... }
  --   calendar { ranges: [{ fromFieldId, toFieldId }] }
  config     jsonb not null default '{}'::jsonb,

  -- Public sharing. NULL share_id = not shared.
  share_id            text unique,
  share_password_hash text,
  share_options       jsonb not null default '{}'::jsonb,  -- { allowDownload, embed }

  sort_order numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- A personal view must have an owner; a collaborative one must not.
  constraint views_personal_has_owner check (
    (lock_type = 'personal' and owner_id is not null) or
    (lock_type <> 'personal')
  )
);

create index views_table_idx on public.views (table_id, sort_order)
  where deleted_at is null;

create unique index views_one_default on public.views (table_id)
  where is_default and deleted_at is null;

-- Per-view, per-field settings. This is what makes a view a view.
create table public.view_fields (
  view_id        uuid not null references public.views(id) on delete cascade,
  field_id       uuid not null references public.fields(id) on delete cascade,
  base_id        uuid not null references public.bases(id) on delete cascade,

  show           boolean not null default true,
  sort_order     numeric not null default 0,
  width          int,

  -- Column footer summary. Gated per field type in the app
  -- (count/sum/avg/min/max/median/…). See docs/SPEC.md §3.8.
  aggregation    text,

  -- Grouping is NOT a separate table — it's three columns here.
  -- Multi-level grouping falls out of group_by_order for free.
  group_by       boolean not null default false,
  group_by_order numeric,
  group_by_dir   text check (group_by_dir in ('asc', 'desc')),

  -- Form view only: { label, help, required, visibleWhen, limitedOptions }
  form_config    jsonb not null default '{}'::jsonb,

  primary key (view_id, field_id)
);


-- ─── Filters ────────────────────────────────────────────────────────────────
--
-- One self-referencing table encoding an arbitrarily nested boolean tree.
-- parent_id is what makes nesting work; depth is unbounded.
--
-- Siblings in a group share ONE logical operator (row 1 reads "Where", row 2
-- offers the and/or dropdown, rows 3+ mirror row 2). Enforce that in the app or
-- you will end up writing "detect mixed operators and normalize" cleanup code.

create table public.filters (
  id             uuid primary key default gen_random_uuid(),
  base_id        uuid not null references public.bases(id) on delete cascade,

  -- Owner. view_id for a view's filters; later this grows hook_id and
  -- row_color_rule_id for webhook conditions and conditional formatting.
  view_id        uuid references public.views(id) on delete cascade,

  parent_id      uuid references public.filters(id) on delete cascade,
  is_group       boolean not null default false,
  logical_op     text not null default 'and' check (logical_op in ('and', 'or', 'not')),

  -- Leaf only.
  field_id       uuid references public.fields(id) on delete cascade,
  op             text,

  -- The date sub-operator. This is what makes "due in the next 7 days" a
  -- STORED, RELATIVE, re-evaluated-every-query filter instead of a frozen
  -- literal — today / pastNumberOfDays(n) / nextWeek / exactDate / …
  sub_op         text,

  value          jsonb,

  -- A "dynamic condition": compare this field to ANOTHER FIELD on the same
  -- record rather than to a literal.
  value_field_id uuid references public.fields(id) on delete cascade,

  sort_order     numeric not null default 0,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),

  -- A group node carries no condition; a leaf must carry one.
  constraint filters_leaf_or_group check (
    (is_group     and field_id is null     and op is null) or
    (not is_group and field_id is not null and op is not null)
  ),

  -- Must hang off something: a view (root) or another filter (nested).
  constraint filters_has_owner check (
    view_id is not null or parent_id is not null
  )
);

create index filters_view_parent_idx on public.filters (view_id, parent_id, sort_order);


-- ─── Sorts ──────────────────────────────────────────────────────────────────

create table public.sorts (
  id         uuid primary key default gen_random_uuid(),
  view_id    uuid not null references public.views(id) on delete cascade,
  base_id    uuid not null references public.bases(id) on delete cascade,
  field_id   uuid not null references public.fields(id) on delete cascade,
  direction  text not null default 'asc' check (direction in ('asc', 'desc')),
  sort_order numeric not null default 0,  -- precedence: which sort wins
  created_at timestamptz not null default now(),
  unique (view_id, field_id)
);

create index sorts_view_idx on public.sorts (view_id, sort_order);


-- ─── Records ────────────────────────────────────────────────────────────────

create table public.records (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.tables(id) on delete cascade,
  base_id    uuid not null references public.bases(id) on delete cascade,

  -- { [field.key]: value }. Computed fields (link/lookup/rollup/formula/count)
  -- have NO entry here — they are resolved at query time.
  data       jsonb not null default '{}'::jsonb,

  -- FRACTIONAL. See the header. numeric, not int.
  sort_order numeric not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,

  -- Soft delete. Every read must exclude these — put the predicate in the query
  -- builder, not at each call site, so it is impossible to forget.
  deleted_at timestamptz
);

create index records_table_order_idx on public.records (table_id, sort_order)
  where deleted_at is null;

-- Containment. Range/ordering predicates need per-field expression indexes,
-- created lazily by the query engine for fields that are actually filtered on:
--   create index on records ((data->>'fld_status')) where table_id = '…';
create index records_data_gin on public.records using gin (data jsonb_path_ops);


-- ─── Links ──────────────────────────────────────────────────────────────────
--
-- EVERY link is a row here, whatever the cardinality. one/many is a CONSTRAINT
-- and a READ SHAPE, not a different storage layout.
--
-- Versus FK columns + generated junction tables (what NocoDB does): one RLS
-- policy instead of N, reordering for free, no junction tables to create/name/
-- hide/GC, and the entire "has-many and belongs-to drifted out of sync" bug
-- class simply does not exist.

create table public.links (
  id             uuid primary key default gen_random_uuid(),
  base_id        uuid not null references public.bases(id) on delete cascade,
  field_id       uuid not null references public.fields(id) on delete cascade,
  from_record_id uuid not null references public.records(id) on delete cascade,
  to_record_id   uuid not null references public.records(id) on delete cascade,

  -- Linked records have a user-defined order WITHIN each parent.
  sort_order     numeric not null default 0,
  created_at     timestamptz not null default now(),

  unique (field_id, from_record_id, to_record_id)
);

create index links_field_from_idx on public.links (field_id, from_record_id, sort_order);
create index links_field_to_idx   on public.links (field_id, to_record_id);


-- ─── Triggers ───────────────────────────────────────────────────────────────

create function public.swamp_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.swamp_touch_updated_at();
create trigger bases_touch before update on public.bases
  for each row execute function public.swamp_touch_updated_at();
create trigger tables_touch before update on public.tables
  for each row execute function public.swamp_touch_updated_at();
create trigger fields_touch before update on public.fields
  for each row execute function public.swamp_touch_updated_at();
create trigger views_touch before update on public.views
  for each row execute function public.swamp_touch_updated_at();

-- records: also stamp created_by / updated_by. These back the createdBy /
-- modifiedBy field types, which are read-only and must never accept a write.
create function public.swamp_stamp_record()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_by = auth.uid();
    new.updated_by = auth.uid();
  else
    new.updated_at = now();
    new.updated_by = auth.uid();
    new.created_by = old.created_by;   -- not forgeable
    new.created_at = old.created_at;
  end if;
  return new;
end
$$;

create trigger records_stamp before insert or update on public.records
  for each row execute function public.swamp_stamp_record();

-- Whoever creates a workspace owns it.
-- Guarded on auth.uid(): the signup path (below) inserts with no JWT.
create function public.swamp_workspace_owner()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, auth.uid(), 'owner');
  return new;
end
$$;

create trigger workspaces_add_owner after insert on public.workspaces
  for each row when (auth.uid() is not null)
  execute function public.swamp_workspace_owner();

-- Every user gets a workspace at signup. This is an invariant, not seed data:
-- the app has nowhere to put a base without one.
create function public.swamp_bootstrap_workspace()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  ws_id uuid;
begin
  insert into public.workspaces (name) values ('My workspace') returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');
  return new;
end
$$;

create trigger on_auth_user_created_workspace
  after insert on auth.users
  for each row execute function public.swamp_bootstrap_workspace();


-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Every table, in the same migration that creates it. A table that exists for
-- even one deploy without RLS is a table that was public for one deploy.
--
-- The ladder:
--   viewer   → read everything in the base
--   editor   → write records and links; change view config (filters/sorts/fields)
--   creator  → change schema (tables, fields); manage members
--   owner    → delete the base
--
-- View lock/personal rules are enforced in the app, not here — they are a UX
-- boundary, not a security one, and encoding them in SQL makes the policies
-- unreadable.

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.bases             enable row level security;
alter table public.base_members      enable row level security;
alter table public.tables            enable row level security;
alter table public.fields            enable row level security;
alter table public.views             enable row level security;
alter table public.view_fields       enable row level security;
alter table public.filters           enable row level security;
alter table public.sorts             enable row level security;
alter table public.records           enable row level security;
alter table public.links             enable row level security;

-- workspaces
-- `or created_by = auth.uid()` is what makes INSERT ... RETURNING work: the
-- membership row arrives in an AFTER trigger, i.e. after this policy has already
-- run. Without it you cannot read back the workspace you just created.
create policy "workspaces: members read" on public.workspaces
  for select using (
    public.swamp_workspace_role(id) is not null
    or created_by = auth.uid()
  );
create policy "workspaces: anyone create" on public.workspaces
  for insert with check (auth.uid() is not null);
create policy "workspaces: owner update" on public.workspaces
  for update using (public.swamp_workspace_can(id, 'owner'))
  with check (public.swamp_workspace_can(id, 'owner'));
create policy "workspaces: owner delete" on public.workspaces
  for delete using (public.swamp_workspace_can(id, 'owner'));

-- workspace_members
create policy "workspace_members: members read" on public.workspace_members
  for select using (public.swamp_workspace_role(workspace_id) is not null);
create policy "workspace_members: owner write" on public.workspace_members
  for all using (public.swamp_workspace_can(workspace_id, 'owner'))
  with check (public.swamp_workspace_can(workspace_id, 'owner'));

-- bases
-- Every one of these uses swamp_can_IN, passing the row's own workspace_id.
-- They must never call swamp_can(), which would read `bases` — see the note on
-- swamp_base_role_in. This is the difference between "insert a base" working and
-- failing with an RLS violation on a base you're entitled to create.
create policy "bases: members read" on public.bases
  for select using (public.swamp_can_in(id, workspace_id, 'viewer'));
create policy "bases: workspace creator inserts" on public.bases
  for insert with check (public.swamp_workspace_can(workspace_id, 'creator'));
create policy "bases: creator update" on public.bases
  for update using (public.swamp_can_in(id, workspace_id, 'creator'))
  with check (public.swamp_can_in(id, workspace_id, 'creator'));
create policy "bases: owner delete" on public.bases
  for delete using (public.swamp_can_in(id, workspace_id, 'owner'));

-- base_members
create policy "base_members: members read" on public.base_members
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "base_members: creator write" on public.base_members
  for all using (public.swamp_can(base_id, 'creator'))
  with check (public.swamp_can(base_id, 'creator'));

-- SCHEMA — creator and up.
create policy "tables: read" on public.tables
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "tables: creator write" on public.tables
  for all using (public.swamp_can(base_id, 'creator'))
  with check (public.swamp_can(base_id, 'creator'));

create policy "fields: read" on public.fields
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "fields: creator write" on public.fields
  for all using (public.swamp_can(base_id, 'creator'))
  with check (public.swamp_can(base_id, 'creator'));

-- VIEW CONFIG — editor and up. This matches Airtable: editors freely change
-- filters, sorts, grouping and field visibility on collaborative views.
create policy "views: read" on public.views
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "views: editor write" on public.views
  for all using (public.swamp_can(base_id, 'editor'))
  with check (public.swamp_can(base_id, 'editor'));

create policy "view_fields: read" on public.view_fields
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "view_fields: editor write" on public.view_fields
  for all using (public.swamp_can(base_id, 'editor'))
  with check (public.swamp_can(base_id, 'editor'));

create policy "filters: read" on public.filters
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "filters: editor write" on public.filters
  for all using (public.swamp_can(base_id, 'editor'))
  with check (public.swamp_can(base_id, 'editor'));

create policy "sorts: read" on public.sorts
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "sorts: editor write" on public.sorts
  for all using (public.swamp_can(base_id, 'editor'))
  with check (public.swamp_can(base_id, 'editor'));

-- DATA — editor and up.
create policy "records: read" on public.records
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "records: editor write" on public.records
  for all using (public.swamp_can(base_id, 'editor'))
  with check (public.swamp_can(base_id, 'editor'));

create policy "links: read" on public.links
  for select using (public.swamp_can(base_id, 'viewer'));
create policy "links: editor write" on public.links
  for all using (public.swamp_can(base_id, 'editor'))
  with check (public.swamp_can(base_id, 'editor'));


-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- Two different gates, and conflating them costs you an afternoon:
--
--   GRANT  — "may this role touch this table at all?"  Failing it raises
--            `permission denied for table x` (42501), before RLS is consulted.
--   RLS    — "which ROWS may it touch?"  Failing it returns zero rows on a read
--            and raises a policy violation on a write.
--
-- RLS is the security boundary. GRANT is just the door. Supabase's convention is
-- to grant broadly and let RLS do the real work, which is why `anon` gets a
-- grant here despite having no policy that will ever match.
--
-- Supabase normally handles this via ALTER DEFAULT PRIVILEGES configured FOR
-- ROLE postgres — so any table postgres creates is granted automatically. But
-- that only fires if the migration actually runs as postgres, and the CLI does
-- not guarantee it. Relying on an implicit default that depends on which role
-- happens to execute your DDL is how you end up with a schema that works in the
-- dashboard and 42501s everywhere else.
--
-- So: grant explicitly. It is self-documenting and it does not care who runs it.

grant usage on schema public to anon, authenticated, service_role;

-- Everything in public, including the pre-existing profiles/datasets/sheets
-- tables, which may never have been granted locally for the reason above.
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines  in schema public to anon, authenticated, service_role;

-- And for anything created after this migration.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
