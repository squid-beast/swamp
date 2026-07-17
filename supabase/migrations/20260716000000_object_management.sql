-- Object management: make base deletion mean what the schema already says.
--
-- Everything here exists to support table/base rename+delete, which had data-layer
-- functions (`updateTable`, `deleteTable`, `createBase`) and no caller at all. Wiring
-- those up is mostly application work — except for one hole that has to be closed
-- down here, because RLS can't express it.
--
-- ── The hole ──
--
-- The bases policies split authority deliberately:
--
--     "bases: creator update"  →  swamp_can_in(id, workspace_id, 'creator')
--     "bases: owner delete"    →  swamp_can_in(id, workspace_id, 'owner')
--
-- Rename is a creator's job; destroying a base is an owner's. But `bases` also has
-- `deleted_at` (indexed `where deleted_at is null`, and `listBases` filters on it),
-- so deletion in this model is SOFT — and a soft delete is an UPDATE. It therefore
-- travels through the *creator* policy, and the owner rule guards only the hard
-- DELETE that nothing calls. A creator could tombstone a base the schema reserves
-- for owners.
--
-- ── Why a trigger and not a policy ──
--
-- The rule is about a TRANSITION (deleted_at changing), and RLS can't see the old
-- row and the new row together in a way that lets one permissive policy narrow
-- another — policies OR, so adding an owner policy would widen, not restrict.
-- A BEFORE UPDATE trigger sees `old` and `new` at once, and sees every writer:
-- route, RPC, or a hand-typed psql statement. One rule, enforced once, rather than
-- an owner check copy-pasted into each caller and forgotten in the next one.
--
-- Note this guards un-delete too (`is distinct from` catches null -> ts AND
-- ts -> null), which is right: restoring a base is as much an owner's call as
-- removing it.

create or replace function public.swamp_bases_guard_soft_delete()
returns trigger
language plpgsql
-- security invoker, like the policies themselves: this must evaluate as the caller,
-- never as the definer, or it would answer "can they?" about the wrong person.
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and not public.swamp_can_in(old.id, old.workspace_id, 'owner')
  then
    -- 42501 = insufficient_privilege. The REST layer already maps this to 403,
    -- so it arrives at the client as a permission error rather than a 500.
    raise exception 'only a base owner can delete or restore a base'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- swamp_can_in (not swamp_can) on purpose: swamp_can reads `bases`, and this fires
-- *during* a write to `bases`. The workspace_id is right there on the row, which is
-- exactly why the bases policies take this shape too.
drop trigger if exists bases_guard_soft_delete on public.bases;
create trigger bases_guard_soft_delete
  before update on public.bases
  for each row
  execute function public.swamp_bases_guard_soft_delete();
