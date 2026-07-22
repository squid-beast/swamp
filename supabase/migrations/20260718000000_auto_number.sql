-- ════════════════════════════════════════════════════════════════════════════
-- autoNumber — a durable, gap-free, monotonic sequence per field.
--
-- The lead-gen story needs one thing every CRM has and a spreadsheet does not: a
-- STABLE id you can print on a quote, paste into an email, and say out loud on a
-- call. "Lead #1043", not a uuid. Airtable calls it Auto Number; so do we.
--
-- The three properties that make it worth having a migration rather than a
-- DEFAULT on a column:
--
--   1. It is UN-FORGEABLE. Like created_by, the client never sets it — the
--      database assigns it on INSERT and refuses to let an UPDATE change it. A
--      row's number is decided once, by the server, and is that number forever.
--   2. It is assigned on EVERY ingress at once — grid, v1 API, public form — with
--      no per-route code, because it lives in a trigger on `records`. Adding a new
--      way to create a record cannot forget to number it.
--   3. It is gap-free and never reused. A deleted #7 does not free up 7; the next
--      row is #(highest ever). That is what makes it safe to reference externally.
--
-- The value is stored as a plain integer in `record.data` (so it sorts and
-- filters as a number — see swamp_is_numeric_type below); any prefix/padding
-- ("LEAD-0007") is presentation, applied by the cell, never stored.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── The enum, extended ─────────────────────────────────────────────────────
--
-- ADD VALUE runs inside the migration's transaction (PG12+ allows it as long as
-- the new label is not USED in the same transaction — and it isn't: the trigger
-- bodies below compare a text literal to the column, they don't cast to the enum
-- at creation time).
alter type public.swamp_field_type add value if not exists 'autoNumber';


-- ─── Numeric for the query engine ───────────────────────────────────────────
--
-- swamp_field_expr sends numeric types through swamp_to_numeric, so a filter like
-- "number is greater than 1000" and a numeric sort both work. autoNumber IS a
-- number, so it joins the list. CREATE OR REPLACE preserves the function's ACL —
-- anon never had direct EXECUTE and still won't; the anon-facing query functions
-- reach it through their SECURITY DEFINER context, not a grant.
create or replace function public.swamp_is_numeric_type(t text)
returns boolean language sql immutable parallel safe as $$
  select t in ('number', 'currency', 'percent', 'rating', 'year', 'duration', 'autoNumber')
$$;


-- ─── The counters ───────────────────────────────────────────────────────────
--
-- One row per autoNumber field. `next_val` is the HIGHEST value handed out so
-- far, so the assignment is a single atomic upsert that both increments and reads
-- the number back — no separate read, no race between two concurrent inserts.
create table public.field_counters (
  field_id uuid primary key references public.fields (id) on delete cascade,
  next_val bigint not null default 0
);

-- Reached ONLY through the SECURITY DEFINER triggers below. No policy, and the
-- anon grant that Supabase's default privileges hand to every new table is
-- stripped — the anon-surface guard asserts anon can touch no table directly, and
-- this is a table anon has no business seeing at all.
alter table public.field_counters enable row level security;
revoke all on table public.field_counters from anon;


-- ─── Assign on insert, freeze on update ─────────────────────────────────────
--
-- SECURITY DEFINER: the trigger writes field_counters and reads fields, neither
-- of which the writing role (often `anon` holding a token, whose insert runs
-- inside a definer API function) can touch directly. Same shape as
-- swamp_audit_record.
--
-- INSERT: assign the next value, ALWAYS, overwriting anything the client sent.
--         That is what makes it un-forgeable — a POST that includes the field is
--         ignored, exactly as a POST claiming created_by would be.
-- UPDATE: restore the stored value if the row already had one. A PATCH cannot
--         renumber a record. (The "already had one" guard is what lets the
--         backfill below set the value for the first time via an UPDATE.)
create function public.swamp_assign_auto_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f    record;
  v_next bigint;
begin
  for v_f in
    select id, key
      from public.fields
     where table_id = new.table_id
       and type = 'autoNumber'
       and deleted_at is null
  loop
    if tg_op = 'INSERT' then
      insert into public.field_counters (field_id, next_val)
      values (v_f.id, 1)
      on conflict (field_id) do update
        set next_val = public.field_counters.next_val + 1
      returning next_val into v_next;

      new.data := jsonb_set(
        coalesce(new.data, '{}'::jsonb), array[v_f.key], to_jsonb(v_next)
      );
    else
      -- UPDATE. The number is immutable once assigned; put the old one back. If
      -- the row never had one (only possible mid-backfill), leave the new value
      -- so the backfill can seed it.
      if old.data ? v_f.key then
        new.data := jsonb_set(
          coalesce(new.data, '{}'::jsonb), array[v_f.key], old.data->v_f.key
        );
      end if;
    end if;
  end loop;

  return new;
end
$$;

create trigger records_auto_number
  before insert or update on public.records
  for each row execute function public.swamp_assign_auto_number();


-- ─── Backfill an autoNumber added to a table that already has rows ───────────
--
-- Airtable numbers existing rows in their current order the moment you add the
-- field. So do we: walk the live rows by (sort_order, id), hand each the next
-- integer, and seed the counter to the last one used. New inserts continue from
-- there via the trigger above.
--
-- The UPDATEs fire records_auto_number's UPDATE branch, which leaves the value
-- alone because the row has no number YET (see the guard above) — so the backfill
-- wins, and every subsequent PATCH is frozen out.
create function public.swamp_backfill_auto_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_n   bigint := 0;
begin
  if new.type <> 'autoNumber' then
    return new;
  end if;

  for v_row in
    select id
      from public.records
     where table_id = new.table_id
       and deleted_at is null
     order by sort_order, id
  loop
    v_n := v_n + 1;
    update public.records
       set data = jsonb_set(coalesce(data, '{}'::jsonb), array[new.key], to_jsonb(v_n))
     where id = v_row.id;
  end loop;

  insert into public.field_counters (field_id, next_val)
  values (new.id, v_n)
  on conflict (field_id) do update set next_val = excluded.next_val;

  return new;
end
$$;

create trigger fields_backfill_auto_number
  after insert on public.fields
  for each row execute function public.swamp_backfill_auto_number();


-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- Trigger functions do NOT need EXECUTE granted for the trigger to fire — Postgres
-- runs them as part of the triggering statement. So strip PUBLIC and anon (which a
-- fresh `create function` and Supabase's default privileges both hand out), and
-- grant nobody: these are reachable only as triggers, never as a call. This keeps
-- them off the anon surface the guard test polices.
revoke all on function public.swamp_assign_auto_number() from public, anon;
revoke all on function public.swamp_backfill_auto_number() from public, anon;

do $$
begin
  assert not has_function_privilege('anon', 'public.swamp_assign_auto_number()', 'execute'),
         'anon must not reach swamp_assign_auto_number';
  assert not has_function_privilege('anon', 'public.swamp_backfill_auto_number()', 'execute'),
         'anon must not reach swamp_backfill_auto_number';
  assert not has_table_privilege('anon', 'public.field_counters', 'select'),
         'anon must not read field_counters';
end $$;
