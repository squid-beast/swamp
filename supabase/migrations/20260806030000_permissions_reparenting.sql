-- ════════════════════════════════════════════════════════════════════════════
-- Table & field permissions — closing three holes the first hardening missed.
--
-- 1. RE-PARENTING (critical). 20260806020000 stopped the caller lying about
--    base_id, but every key is still resolved from new.table_id — which is just
--    as client-controlled, and mutable. Two statements defeat all three keys:
--
--      UPDATE records SET table_id = <scratch table in the same base>,
--                         data = <locked field changed>
--        → the field loop iterates the SCRATCH table's fields, finds no rules,
--          and allows the write.
--      UPDATE records SET table_id = <original>
--        → data is unchanged, so `new.data is distinct from old.data` is false
--          and the loop never runs.
--
--    The row is back in the ruled table carrying the forbidden value, base_id
--    never moved, and nothing errored. table_record_delete falls in ONE
--    statement (move and soft-delete together); table_record_add falls by
--    inserting into the scratch table and moving the row afterwards.
--
--    The fix is not a fourth guard inside the permission trigger — it is to
--    make the lie unrepresentable. Nothing in the product moves a record
--    between tables: every server-side UPDATE on records touches deleted_at,
--    data or sort_order, and swamp_move_record only rewrites fractional order.
--
-- 2. has_permissions WAS A CLIENT-WRITABLE KILL SWITCH (medium). It is a plain
--    boolean column on `bases`, and the bases UPDATE policy is creator-level —
--    so `update bases set has_permissions = false` disabled every rule in the
--    base in one request, with the rules still sitting there looking enforced.
--    A derived value must not be writable.
--
-- 3. See features/sheets/sync-service.ts for the third (the Sheets cron writes
--    as service_role into a user-chosen table); it is fixed app-side, in the one
--    place that legitimately runs with RLS off.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. A record cannot change tables ───────────────────────────────────────

create or replace function public.swamp_record_table_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'swamp: a record cannot change tables' using errcode = '23514';
end
$$;

-- The WHEN clause is evaluated by the executor, so the body never runs on a
-- normal write — this costs a column comparison, not a query.
--
-- It RAISES rather than silently reverting new.table_id, and that matters:
-- Postgres fires per-row BEFORE triggers alphabetically, and `records_stamp`
-- sorts AFTER `records_permissions`. A silent revert placed in the stamp trigger
-- would land after the permission check had already run against the spoofed
-- table — enforcement bypassed, write allowed, nobody any the wiser.
create trigger records_table_immutable
  before update on public.records
  for each row when (new.table_id is distinct from old.table_id)
  execute function public.swamp_record_table_immutable();

revoke all on function public.swamp_record_table_immutable() from public, anon;

-- ─── 2. has_permissions is derived, not stored-and-trusted ──────────────────

create or replace function public.swamp_bases_guard_has_permissions()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Recompute from the rules rather than refusing the write: an ordinary base
  -- update (rename, share, soft-delete) sends the whole row back, so rejecting
  -- a changed value would break every one of them. Overwriting is both quiet
  -- for honest callers and total for dishonest ones.
  new.has_permissions := exists (
    select 1 from public.permissions p where p.base_id = new.id
  );
  return new;
end
$$;

create trigger bases_guard_has_permissions
  before update on public.bases
  for each row execute function public.swamp_bases_guard_has_permissions();

revoke all on function public.swamp_bases_guard_has_permissions() from public, anon;
