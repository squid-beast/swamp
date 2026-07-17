-- Let the client learn what a write recomputed.
--
-- Edit a number a formula sums, and the formula sits at its old value until you
-- reload. Same for rollups, lookups, counts, modifiedTime/modifiedBy, and the new
-- barcode/qr. Three things line up to cause it:
--
--   1. features/tables/commands.ts applyPatches merges only the keys you WROTE:
--      { ...r.data, ...values }. A computed key can never be among them —
--      use-grid.ts returns early on isReadOnlyField.
--   2. The write path returns nothing to merge. swamp_patch_records returns an
--      integer row count (record_writes.sql:30-55), repo.ts discards even that, and
--      the PATCH route answers { ok: true }.
--   3. Computed values exist ONLY inside swamp_query_records' projection
--      (platform.sql:1605-1618). `records.data` on disk holds stored scalars.
--
-- So nothing recomputes until the next full fetch. This function is the missing
-- piece: given some ids, what do their computed fields say NOW?
--
-- ── Computed keys only, never scalars ──
--
-- It returns ONLY computed keys. That is the whole safety argument, not an
-- optimisation:
--
--   * The undo stack captures `before` scalars and re-applies them. If a write
--     echoed scalars back, a slow response could land on top of a newer edit — or
--     on top of an undo — and put the old value back under the cursor.
--   * You may still be typing. Overwriting what someone typed with what the server
--     had is the classic collaborative-editor bug.
--
-- NocoDB reached the identical conclusion; nc-gui/composables/useData.ts:156-159
-- says it out loud: "update only formula, rollup and auto updated datetime columns
-- data to avoid overwriting any changes made by user".
--
-- ── Why not just refetch ──
--
-- reload() replaces the whole window (use-records.ts), so after editing a cell on
-- page 3 you would snap back to page 1. It is right for a link edit — which changes
-- rollups on records you cannot even see, hence onLinksChanged={reload} — and wrong
-- for a cell edit, where the blast radius is known.

-- The one list that decides "is this value stored, or computed at read time?".
--
-- It is currently written out in two other places — swamp_query_records
-- (platform.sql:1611) and swamp_api_get (platform.sql:488) — and getting it wrong
-- means a field silently reads null. This is the third place, so it becomes a
-- function instead of a third copy; the other two can adopt it whenever they are
-- next touched, without a 217-line rewrite just for this.
--
-- Note barcode/qr are absent on purpose: they register in the catalog AS 'formula'
-- (see 20260716040000_barcode_qr.sql), so they are already covered.
create or replace function public.swamp_is_computed_type(p_type text)
returns boolean
language sql immutable parallel safe
as $$
  select p_type in (
    'link', 'lookup', 'rollup', 'count', 'formula',
    'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy'
  )
$$;

-- The computed fields of specific records, projected exactly as the read path
-- projects them.
--
-- SECURITY INVOKER (the default), like swamp_query_records and swamp_patch_records:
-- RLS applies, so this cannot hand back a row the caller could not already read.
-- The catalog call also fails closed on a table they cannot see.
create or replace function public.swamp_computed_values(
  p_table_id uuid,
  p_ids      uuid[]
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cat      jsonb;
  v_key      text;
  v_type     text;
  v_computed text[] := '{}';
  v_sql      text;
  v_out      jsonb;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return '[]'::jsonb;
  end if;

  v_cat := public.swamp_field_catalog(p_table_id, null);

  if v_cat is null or v_cat = '{}'::jsonb then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  for v_key, v_type in select key, value->>'type' from jsonb_each(v_cat)
  loop
    if public.swamp_is_computed_type(v_type) then
      v_computed := v_computed || format('%L, to_jsonb(%s)', v_key, v_cat->v_key->>'expr');
    end if;
  end loop;

  -- The common table has no computed fields at all. Say so without touching the
  -- heap: the caller then skips its merge entirely, and an ordinary grid pays
  -- nothing for this feature beyond one cheap catalog read.
  if array_length(v_computed, 1) is null then
    return '[]'::jsonb;
  end if;

  v_sql := format($q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',     r.id,
             'values', jsonb_build_object(%s)
           )), '[]'::jsonb)
      from public.records r
     where r.table_id = %L::uuid
       and r.deleted_at is null
       and r.id = any(%L::uuid[])
  $q$, array_to_string(v_computed, ', '), p_table_id, p_ids);

  execute v_sql into v_out;
  return v_out;
end
$$;

-- Grant EXPLICITLY, per function.
--
-- Do NOT write `grant all on all routines in schema public to anon, ...` here, however
-- much the older migrations look like a precedent (workspace_schema.sql:764,
-- query_engine.sql:637, and three others all do it). platform.sql:1757 deliberately
-- REVOKED all routines from anon and re-granted only to authenticated + service_role.
-- A blanket grant in a later migration silently undoes that revoke and re-opens the
-- entire schema — every SECURITY DEFINER function included — to anonymous callers.
-- The blast radius of that one convenient line is the whole product.
revoke all on function public.swamp_computed_values(uuid, uuid[]) from public;
revoke all on function public.swamp_computed_values(uuid, uuid[]) from anon;
grant execute on function public.swamp_computed_values(uuid, uuid[]) to authenticated;

revoke all on function public.swamp_is_computed_type(text) from public;
revoke all on function public.swamp_is_computed_type(text) from anon;
grant execute on function public.swamp_is_computed_type(text) to authenticated;

do $$
begin
  assert not has_function_privilege('anon', 'public.swamp_computed_values(uuid,uuid[])', 'execute'),
         'anon must not reach swamp_computed_values';
  assert has_function_privilege('authenticated', 'public.swamp_computed_values(uuid,uuid[])', 'execute'),
         'authenticated must reach swamp_computed_values';
end $$;
