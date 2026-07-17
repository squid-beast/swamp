-- The REST API's write response tells the truth about what it wrote.
--
-- swamp_api_insert and swamp_api_patch both returned `r.data` raw. `data` is the
-- stored jsonb — the scalars the caller sent — and NOTHING else. Every computed field
-- is absent from it by construction: formulas, rollups, lookups, counts, barcode/QR,
-- createdBy/modifiedBy, createdTime/modifiedTime are projected at READ time by
-- swamp_query_records, and are not columns in `data` at all.
--
-- So a REST caller who patched a row got back a record whose `fields` silently lacked
-- exactly the values the write had just recalculated. Their two options were both bad:
-- believe the response, and hold a record with a missing Total; or issue a second GET
-- for every write, and race anyone else editing the row.
--
-- The app path was fixed in `Computed fields refresh when you edit what they depend
-- on` (20260716050000_computed_after_write.sql). This is the same gap in the other
-- client — the one whose users cannot see the grid and have nothing to compare
-- against.
--
-- ── Reusing swamp_computed_values rather than writing the projection again ──
--
-- The projection exists three times over already (swamp_query_records builds it,
-- swamp_computed_values builds it, the catalog defines the exprs). A fourth copy here
-- would be a fourth thing to keep in step the next time a field type is added — and
-- the barcode/QR migration proved how that goes: it registers those types AS formulas
-- specifically so the existing projection picks them up untouched.
--
-- swamp_computed_values returns [{id, values:{...}}], returns '[]' cheaply when the
-- table has no computed fields at all (one catalog read, no heap access), and is
-- SECURITY INVOKER. Called from inside these SECURITY DEFINER functions it runs as the
-- owner, so RLS does not narrow it — which is correct and not a hole: authorization
-- already happened above, at swamp_api_require (token + scope + live role) and
-- swamp_api_table (the row must be in the token's own base). By the time we are here,
-- the caller has been proved entitled to these exact records.

create or replace function public.swamp_api_insert(
  p_token    text,
  p_table_id uuid,
  p_records  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx      jsonb;
  v_table    public.tables;
  v_order    numeric;
  v_row      jsonb;
  v_ids      uuid[] := '{}';
  v_id       uuid;
  v_computed jsonb;
begin
  v_ctx   := public.swamp_api_require(p_token, 'records:write', 'editor');
  v_table := public.swamp_api_table(v_ctx, p_table_id);

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'swamp: records must be an array';
  end if;
  if jsonb_array_length(p_records) > 1000 then
    raise exception 'swamp: at most 1000 records per call';
  end if;

  select coalesce(max(sort_order), 0) into v_order
    from public.records
   where table_id = p_table_id and deleted_at is null;

  for v_row in select * from jsonb_array_elements(p_records) loop
    v_order := v_order + 1;

    insert into public.records (table_id, base_id, data, sort_order)
    values (
      p_table_id,
      v_table.base_id,
      public.swamp_pick_writable(p_table_id, coalesce(v_row->'fields', '{}'::jsonb)),
      v_order
    )
    returning id into v_id;

    v_ids := v_ids || v_id;
  end loop;

  -- After the inserts: a formula over the new row's own values can only be computed
  -- once the row exists.
  v_computed := public.swamp_computed_values(p_table_id, v_ids);

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id',     r.id,
               -- Computed values go on the RIGHT of ||, so they win. They are derived
               -- from what was just stored, and `data` cannot hold a computed key
               -- anyway (swamp_pick_writable drops them on the way in), so there is
               -- nothing of the caller's to clobber.
               'fields', r.data || coalesce(
                 (select c->'values'
                    from jsonb_array_elements(v_computed) c
                   where (c->>'id')::uuid = r.id),
                 '{}'::jsonb
               ),
               'createdTime', r.created_at
             )
             order by r.sort_order
           )
      from public.records r
     where r.id = any(v_ids)
  ), '[]'::jsonb);
end
$$;


create or replace function public.swamp_api_patch(
  p_token    text,
  p_table_id uuid,
  p_records  jsonb   -- [{ "id": "...", "fields": { "fld_x": 1 } }, ...]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx      jsonb;
  v_row      jsonb;
  v_patches  jsonb := '[]'::jsonb;
  v_ids      uuid[] := '{}';
  v_computed jsonb;
begin
  v_ctx := public.swamp_api_require(p_token, 'records:write', 'editor');
  perform public.swamp_api_table(v_ctx, p_table_id);

  for v_row in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    v_patches := v_patches || jsonb_build_object(
      'id',     v_row->>'id',
      'values', public.swamp_pick_writable(p_table_id, coalesce(v_row->'fields', '{}'::jsonb))
    );
    v_ids := v_ids || (v_row->>'id')::uuid;
  end loop;

  -- The same merge the app uses: `data || patch`, INSIDE the update. Two writers
  -- touching different cells of the same row both survive.
  perform public.swamp_patch_records(p_table_id, v_patches);

  -- AFTER the write, never before: recomputing first would return the old Total for
  -- the new Quantity, which is worse than returning no Total at all.
  v_computed := public.swamp_computed_values(p_table_id, v_ids);

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id',     r.id,
               'fields', r.data || coalesce(
                 (select c->'values'
                    from jsonb_array_elements(v_computed) c
                   where (c->>'id')::uuid = r.id),
                 '{}'::jsonb
               )
             )
           )
      from public.records r
     where r.id = any(v_ids) and r.table_id = p_table_id and r.deleted_at is null
  ), '[]'::jsonb);
end
$$;

-- `create or replace` preserves grants, so the anon EXECUTE these two need (they are
-- the token-authed public API — the token is the credential, not the anon key) is
-- untouched. Asserted rather than assumed, because this migration follows one that
-- deliberately revoked a great many things.
do $$
begin
  assert has_function_privilege('anon', 'public.swamp_api_insert(text,uuid,jsonb)', 'execute'),
         'anon lost swamp_api_insert';
  assert has_function_privilege('anon', 'public.swamp_api_patch(text,uuid,jsonb)', 'execute'),
         'anon lost swamp_api_patch';
end $$;
