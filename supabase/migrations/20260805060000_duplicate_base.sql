-- ════════════════════════════════════════════════════════════════════════════
-- Duplicate a BASE — every table, field, view, filter and sort, in one
-- transaction. Schema only: "template my base" is the use case, it is
-- O(schema) not O(rows), and it fits inside a 60s function. Records are a
-- follow-on (they drag the links edge table and a record-id remap with them).
--
-- ── Why base-scope can copy what table-scope must skip ──
--
-- swamp_duplicate_table skips formula/link/lookup/rollup/count/button because
-- their targets live OUTSIDE the copy. In a base copy they don't: every table,
-- field and view comes across together, so one old-id → new-id map per object
-- kind makes every cross-reference rewritable. That map is this file.
--
-- What gets rewritten, and where it lives:
--   fields.options    targetTableId (tables map) · linkFieldId, targetFieldId,
--                     symmetricFieldId, sourceFieldId (fields map) · ast
--                     (recursive {t:"field",id} rewrite via swamp_remap_ast)
--   views.config      stackFieldId, coverFieldId, coordFieldId,
--                     dependencyFieldId, colorFieldId · ranges[].fromFieldId/
--                     toFieldId. rowColorRules reference field KEYS, and keys
--                     copy verbatim — no rewrite needed, by design.
--   view_fields       field_id · form_config.visibleWhen.fieldId
--   filters           field_id, value_field_id, parent_id (tree preserved)
--   sorts             field_id
--
-- Deliberately NOT copied:
--   · webhooks (they hold secrets and point at external servers — a copied base
--     silently POSTing to the original's endpoints is a trap, not a feature).
--     A button field with action=webhook therefore loses its webhookId and
--     shows as unconfigured in the copy.
--   · share state (share_id is unique; a copy must never inherit an audience).
--   · records (see above).
--
-- ── Security ──
--
-- SECURITY INVOKER, like swamp_duplicate_table: every insert runs as the
-- caller under RLS. Creating a base is workspace-creator-gated, tables and
-- fields are base-creator-gated — an editor fails on the first insert with no
-- privilege they didn't already lack.
-- ════════════════════════════════════════════════════════════════════════════

-- Rewrite {t:"field", id: X} nodes through the map, recursively. An id not in
-- the map is kept — the catalog then renders that formula as an error, which is
-- honest (it referenced something outside the copied base).
create or replace function public.swamp_remap_ast(p_node jsonb, p_map jsonb)
returns jsonb
language plpgsql immutable
as $$
declare
  v_out  jsonb;
  v_item jsonb;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'object' then
    return p_node;
  end if;

  v_out := p_node;

  if p_node->>'t' = 'field' and p_map ? (p_node->>'id') then
    v_out := jsonb_set(v_out, '{id}', p_map -> (p_node->>'id'));
  end if;

  -- Child positions the compiler knows: l/r (binary), a (unary), args (call).
  if p_node ? 'l' then
    v_out := jsonb_set(v_out, '{l}', public.swamp_remap_ast(p_node->'l', p_map));
  end if;
  if p_node ? 'r' then
    v_out := jsonb_set(v_out, '{r}', public.swamp_remap_ast(p_node->'r', p_map));
  end if;
  if p_node ? 'a' then
    v_out := jsonb_set(v_out, '{a}', public.swamp_remap_ast(p_node->'a', p_map));
  end if;
  if p_node ? 'args' and jsonb_typeof(p_node->'args') = 'array' then
    select jsonb_set(v_out, '{args}', coalesce(jsonb_agg(public.swamp_remap_ast(e, p_map)), '[]'::jsonb))
      into v_out
      from jsonb_array_elements(p_node->'args') e;
  end if;

  return v_out;
end
$$;

-- Replace the value at each named key when it is a string present in the map.
-- The workhorse for options/config jsonb, where ids live at known keys.
create or replace function public.swamp_remap_ids(p_obj jsonb, p_keys text[], p_map jsonb)
returns jsonb
language plpgsql immutable
as $$
declare
  v_out jsonb := p_obj;
  v_key text;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    return p_obj;
  end if;
  foreach v_key in array p_keys
  loop
    if v_out ? v_key and p_map ? (v_out->>v_key) then
      v_out := jsonb_set(v_out, array[v_key], p_map -> (v_out->>v_key));
    end if;
  end loop;
  return v_out;
end
$$;

create or replace function public.swamp_duplicate_base(
  p_base_id uuid,
  p_name    text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_src     public.bases;
  v_new     uuid;
  v_tmap    jsonb := '{}'::jsonb;   -- old table id  -> new table id
  v_fmap    jsonb := '{}'::jsonb;   -- old field id  -> new field id
  v_vmap    jsonb := '{}'::jsonb;   -- old view id   -> new view id
  v_flmap   jsonb := '{}'::jsonb;   -- old filter id -> new filter id
  v_row     record;
  v_id      uuid;
  v_opts    jsonb;
  v_cfg     jsonb;
  v_ranges  jsonb;
  v_r       jsonb;
begin
  select * into v_src
    from public.bases
   where id = p_base_id and deleted_at is null;

  if v_src.id is null then
    raise exception 'swamp: no such base' using errcode = '42P01';
  end if;

  insert into public.bases (workspace_id, name)
  values (v_src.workspace_id, left(coalesce(nullif(trim(p_name), ''), v_src.name || ' copy'), 120))
  returning id into v_new;

  -- ── Tables ──
  for v_row in
    select * from public.tables
     where base_id = p_base_id and deleted_at is null
     order by sort_order
  loop
    insert into public.tables (base_id, name, sort_order)
    values (v_new, v_row.name, v_row.sort_order)
    returning id into v_id;
    v_tmap := jsonb_set(v_tmap, array[v_row.id::text], to_jsonb(v_id::text));
  end loop;

  -- ── Fields — everything, options verbatim for now ──
  for v_row in
    select f.* from public.fields f
      join public.tables t on t.id = f.table_id and t.deleted_at is null
     where f.base_id = p_base_id and f.deleted_at is null
     order by f.table_id, f.sort_order
  loop
    insert into public.fields
      (table_id, base_id, name, key, type, options, is_primary, sort_order)
    values
      ((v_tmap->>(v_row.table_id::text))::uuid, v_new,
       v_row.name, v_row.key, v_row.type, v_row.options, v_row.is_primary, v_row.sort_order)
    returning id into v_id;
    v_fmap := jsonb_set(v_fmap, array[v_row.id::text], to_jsonb(v_id::text));
  end loop;

  -- ── Rewrite the copied options, now that both maps are complete ──
  for v_row in
    select id, options from public.fields where base_id = v_new
  loop
    v_opts := public.swamp_remap_ids(v_row.options, array['targetTableId'], v_tmap);
    v_opts := public.swamp_remap_ids(
      v_opts,
      array['linkFieldId', 'targetFieldId', 'symmetricFieldId', 'sourceFieldId'],
      v_fmap
    );
    -- Webhooks are not copied (see header): a dangling webhookId must go.
    v_opts := v_opts - 'webhookId';
    if v_opts ? 'ast' then
      v_opts := jsonb_set(v_opts, '{ast}', public.swamp_remap_ast(v_opts->'ast', v_fmap));
    end if;
    if v_opts is distinct from v_row.options then
      update public.fields set options = v_opts where id = v_row.id;
    end if;
  end loop;

  -- ── Views ──
  for v_row in
    select v.* from public.views v
      join public.tables t on t.id = v.table_id and t.deleted_at is null
     where v.base_id = p_base_id and v.deleted_at is null
     order by v.sort_order
  loop
    v_cfg := public.swamp_remap_ids(
      v_row.config,
      array['stackFieldId', 'coverFieldId', 'coordFieldId', 'dependencyFieldId', 'colorFieldId'],
      v_fmap
    );

    -- ranges: [{fromFieldId, toFieldId?}] — remap inside each element.
    if v_cfg ? 'ranges' and jsonb_typeof(v_cfg->'ranges') = 'array' then
      v_ranges := '[]'::jsonb;
      for v_r in select * from jsonb_array_elements(v_cfg->'ranges')
      loop
        v_ranges := v_ranges || public.swamp_remap_ids(
          v_r, array['fromFieldId', 'toFieldId'], v_fmap
        );
      end loop;
      v_cfg := jsonb_set(v_cfg, '{ranges}', v_ranges);
    end if;
    -- rowColorRules reference field KEYS; keys copy verbatim — nothing to do.

    insert into public.views
      (table_id, base_id, type, name, is_default, lock_type, owner_id, config, sort_order)
    values
      ((v_tmap->>(v_row.table_id::text))::uuid, v_new,
       v_row.type, v_row.name, v_row.is_default, v_row.lock_type, v_row.owner_id,
       v_cfg, v_row.sort_order)
    returning id into v_id;
    v_vmap := jsonb_set(v_vmap, array[v_row.id::text], to_jsonb(v_id::text));
  end loop;

  -- ── View fields ──
  for v_row in
    select vf.* from public.view_fields vf
     where vf.base_id = p_base_id
       and v_vmap ? (vf.view_id::text)
       and v_fmap ? (vf.field_id::text)
  loop
    v_cfg := v_row.form_config;
    if v_cfg ? 'visibleWhen' and (v_cfg->'visibleWhen') ? 'fieldId' then
      v_cfg := jsonb_set(v_cfg, '{visibleWhen}',
        public.swamp_remap_ids(v_cfg->'visibleWhen', array['fieldId'], v_fmap));
    end if;

    insert into public.view_fields
      (view_id, field_id, base_id, show, sort_order, width, aggregation,
       group_by, group_by_order, group_by_dir, form_config)
    values
      ((v_vmap->>(v_row.view_id::text))::uuid,
       (v_fmap->>(v_row.field_id::text))::uuid,
       v_new, v_row.show, v_row.sort_order, v_row.width, v_row.aggregation,
       v_row.group_by, v_row.group_by_order, v_row.group_by_dir, v_cfg);
  end loop;

  -- ── Filters — parents before children so the tree constraint holds ──
  for v_row in
    with recursive tree as (
      select f.*, 0 as depth from public.filters f
       where f.base_id = p_base_id and f.parent_id is null
      union all
      select f.*, tree.depth + 1 from public.filters f
        join tree on f.parent_id = tree.id
    )
    select * from tree order by depth, sort_order
  loop
    -- A filter row is owned by a view (root) or a parent (child); rows whose
    -- view didn't copy (deleted table) or whose field is gone are dropped, the
    -- same rule buildTree applies at read time.
    if v_row.view_id is not null and not (v_vmap ? (v_row.view_id::text)) then
      continue;
    end if;
    if v_row.parent_id is not null and not (v_flmap ? (v_row.parent_id::text)) then
      continue;
    end if;
    if v_row.field_id is not null and not (v_fmap ? (v_row.field_id::text)) then
      continue;
    end if;

    insert into public.filters
      (base_id, view_id, parent_id, is_group, logical_op, field_id, op, sub_op,
       value, value_field_id, sort_order, enabled)
    values
      (v_new,
       case when v_row.view_id is null then null
            else (v_vmap->>(v_row.view_id::text))::uuid end,
       case when v_row.parent_id is null then null
            else (v_flmap->>(v_row.parent_id::text))::uuid end,
       v_row.is_group, v_row.logical_op,
       case when v_row.field_id is null then null
            else (v_fmap->>(v_row.field_id::text))::uuid end,
       v_row.op, v_row.sub_op, v_row.value,
       case when v_row.value_field_id is null or not (v_fmap ? (v_row.value_field_id::text)) then null
            else (v_fmap->>(v_row.value_field_id::text))::uuid end,
       v_row.sort_order, v_row.enabled)
    returning id into v_id;
    v_flmap := jsonb_set(v_flmap, array[v_row.id::text], to_jsonb(v_id::text));
  end loop;

  -- ── Sorts ──
  insert into public.sorts (view_id, base_id, field_id, direction, sort_order)
  select (v_vmap->>(s.view_id::text))::uuid, v_new,
         (v_fmap->>(s.field_id::text))::uuid, s.direction, s.sort_order
    from public.sorts s
   where s.base_id = p_base_id
     and v_vmap ? (s.view_id::text)
     and v_fmap ? (s.field_id::text);

  return v_new;
end
$$;

-- Signed-in users only, acting as themselves; the helpers are only ever called
-- from inside this function but get the same treatment for the anon-surface guard.
revoke all on function public.swamp_duplicate_base(uuid, text) from public, anon;
grant execute on function public.swamp_duplicate_base(uuid, text) to authenticated;

revoke all on function public.swamp_remap_ast(jsonb, jsonb) from public, anon;
grant execute on function public.swamp_remap_ast(jsonb, jsonb) to authenticated;

revoke all on function public.swamp_remap_ids(jsonb, text[], jsonb) from public, anon;
grant execute on function public.swamp_remap_ids(jsonb, text[], jsonb) to authenticated;
