-- ════════════════════════════════════════════════════════════════════════════
-- Duplicate a table — schema and data, in one transaction.
--
-- "Clone my Leads table for the next campaign" is a thing people do constantly, and
-- doing it by hand (recreate every field, re-import every row) is exactly the chore
-- a database is supposed to remove. This does it atomically: the whole copy commits
-- or none of it does, so a duplicate is never half a table.
--
-- ── What comes across, and what doesn't ──
--
-- Every field whose VALUE lives in record.data comes across, keeping its KEY (so the
-- copied rows line up) and getting a fresh id. That is the scalars, plus attachment,
-- user, autoNumber, the created/modified stamps, and barcode/QR (whose pointer to
-- another field is repointed at the copy).
--
-- Left out on purpose: formula, link, lookup, rollup, count and button. Each
-- references OTHER fields or the links edge table by id, so a faithful copy is a
-- cross-table remap — a much bigger promise, and a wrong one is worse than an absent
-- one. The duplicate opens on a clean default grid view showing every copied field;
-- the source's saved views, filters and sorts are not carried over for the same
-- reason (they address fields by id).
--
-- ── Security ──
--
-- SECURITY INVOKER (the default): every read and write inside runs as the caller,
-- under RLS. Creating a table and its fields is CREATOR-gated, so an editor calling
-- this simply fails on the first insert — there is no privilege here the caller
-- didn't already have.
-- ════════════════════════════════════════════════════════════════════════════

create function public.swamp_duplicate_table(
  p_table_id     uuid,
  p_with_records boolean default true
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_src      public.tables;
  v_new      uuid;
  v_base     uuid;
  v_field    record;
  v_fieldmap jsonb := '{}'::jsonb;   -- old field id (text) -> new field id (text)
  v_new_fid  uuid;
begin
  select * into v_src
    from public.tables
   where id = p_table_id and deleted_at is null;

  if v_src.id is null then
    raise exception 'swamp: no such table' using errcode = '42P01';
  end if;

  v_base := v_src.base_id;

  insert into public.tables (base_id, name, sort_order)
  values (
    v_base,
    left(v_src.name || ' copy', 120),
    coalesce((select max(sort_order) + 1 from public.tables where base_id = v_base), 1)
  )
  returning id into v_new;

  -- Self-contained fields only (see the header). Same key, new id.
  for v_field in
    select * from public.fields
     where table_id = p_table_id
       and deleted_at is null
       and type not in ('formula', 'link', 'lookup', 'rollup', 'count', 'button')
     order by sort_order
  loop
    insert into public.fields
      (table_id, base_id, name, key, type, options, is_primary, sort_order)
    values
      (v_new, v_base, v_field.name, v_field.key, v_field.type, v_field.options,
       v_field.is_primary, v_field.sort_order)
    returning id into v_new_fid;

    v_fieldmap := jsonb_set(v_fieldmap, array[v_field.id::text], to_jsonb(v_new_fid::text));
  end loop;

  -- A barcode/QR draws another field; repoint it at the copy, not the original.
  update public.fields f
     set options = jsonb_set(f.options, '{sourceFieldId}',
                             v_fieldmap -> (f.options->>'sourceFieldId'))
   where f.table_id = v_new
     and f.options ? 'sourceFieldId'
     and v_fieldmap ? (f.options->>'sourceFieldId');

  -- A default grid view so the copy opens. Deliberately clean — every field shown,
  -- no filters, no sorts.
  insert into public.views (table_id, base_id, type, name, is_default)
  values (v_new, v_base, 'grid', 'Grid', true);

  -- The rows. Their data copies verbatim because the keys are unchanged; the insert
  -- triggers do the rest (a fresh autoNumber is assigned, stamps are set to now/you).
  if p_with_records then
    insert into public.records (table_id, base_id, data, sort_order)
    select v_new, v_base, r.data, r.sort_order
      from public.records r
     where r.table_id = p_table_id and r.deleted_at is null;
  end if;

  return v_new;
end
$$;

-- Only signed-in users, and only as themselves. anon has no business here, and the
-- default grant to PUBLIC is stripped so the anon-surface guard stays satisfied.
revoke all on function public.swamp_duplicate_table(uuid, boolean) from public, anon;
grant execute on function public.swamp_duplicate_table(uuid, boolean) to authenticated;
