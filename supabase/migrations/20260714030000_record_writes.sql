-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1c — the write path.
--
-- Two operations that cannot be done correctly from the client:
--
--   swamp_patch_records — merge cell values without a lost-update race
--   swamp_move_record   — reorder by fractional midpoint, writing ONE row
--
-- Both are SECURITY INVOKER. RLS applies exactly as it would to a plain UPDATE.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Patch ──────────────────────────────────────────────────────────────────
--
-- The bug this exists to kill:
--
--   The old code read the row, merged the new values into `data` in JavaScript,
--   and wrote the whole blob back. Two people editing DIFFERENT CELLS of the
--   SAME ROW at the same time would both read the old row, and the second write
--   would clobber the first. No error. No conflict. The edit simply vanished,
--   and the person who made it had already seen it appear in their grid.
--
-- `data || patch` performs the merge INSIDE the update, against whatever the row
-- actually holds at that moment. Two edits to different cells now both survive.
-- Two edits to the SAME cell still resolve last-write-wins — which is correct,
-- and is what every spreadsheet does.
--
-- p_patches: [{ "id": "...", "values": { "fld_x": 1 } }]

create function public.swamp_patch_records(
  p_table_id uuid,
  p_patches  jsonb
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with patch as (
    select (p->>'id')::uuid as id,
           coalesce(p->'values', '{}'::jsonb) as values
      from jsonb_array_elements(p_patches) p
  )
  update public.records r
     set data = r.data || patch.values
    from patch
   where r.id = patch.id
     and r.table_id = p_table_id
     and r.deleted_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;


-- ─── Move ───────────────────────────────────────────────────────────────────
--
-- Fractional indexing. To place a row between two neighbours, write the midpoint:
--
--     new = (before + after) / 2
--
-- ONE row is written. No renumbering of siblings, no O(n) update, no lock
-- contention between two people dragging different rows at the same time. This
-- is the entire reason `sort_order` is numeric and not int — with an int column,
-- inserting between 3 and 4 requires shifting every row below it, and row
-- reordering is simply not implementable.
--
-- The server computes the midpoint. Clients do not get to invent sort_order
-- values: two racing clients would pick the same one and the order would become
-- non-deterministic.
--
-- beforeId / afterId are the rows it lands BETWEEN. Either may be null:
--   (null, X) → move to the top, above X
--   (X, null) → move to the bottom, below X
--   (null, null) → move to the bottom of the table

create function public.swamp_move_record(
  p_table_id  uuid,
  p_record_id uuid,
  p_before_id uuid default null,
  p_after_id  uuid default null
)
returns numeric
language plpgsql
as $$
declare
  v_before numeric;
  v_after  numeric;
  v_new    numeric;
begin
  select sort_order into v_before
    from public.records
   where id = p_before_id and table_id = p_table_id and deleted_at is null;

  select sort_order into v_after
    from public.records
   where id = p_after_id and table_id = p_table_id and deleted_at is null;

  if v_before is null and v_after is null then
    -- Bottom of the table.
    select coalesce(max(sort_order), 0) + 1 into v_new
      from public.records
     where table_id = p_table_id and deleted_at is null;

  elsif v_before is null then
    -- Top: half of whatever is currently first. Halving never collides with 0,
    -- so the top of the list can be prepended to indefinitely.
    v_new := v_after / 2;

  elsif v_after is null then
    v_new := v_before + 1;

  else
    v_new := (v_before + v_after) / 2;
  end if;

  -- Precision exhaustion. `numeric` is arbitrary-precision, so this is genuinely
  -- rare — but "rare" is not "never", and a silent collision here means two rows
  -- with the same order and a list that shuffles itself on every read.
  --
  -- Rebalance the whole table to clean integers and retry. O(n), but it happens
  -- roughly never, and the alternative is a bug nobody can reproduce.
  if v_new = v_before or v_new = v_after then
    perform public.swamp_rebalance_order(p_table_id);
    return public.swamp_move_record(p_table_id, p_record_id, p_before_id, p_after_id);
  end if;

  update public.records
     set sort_order = v_new
   where id = p_record_id and table_id = p_table_id;

  return v_new;
end
$$;


create function public.swamp_rebalance_order(p_table_id uuid)
returns void
language plpgsql
as $$
begin
  with ordered as (
    select id, row_number() over (order by sort_order, id) as rn
      from public.records
     where table_id = p_table_id and deleted_at is null
  )
  update public.records r
     set sort_order = ordered.rn
    from ordered
   where r.id = ordered.id;
end
$$;


grant all on all routines in schema public to anon, authenticated, service_role;
