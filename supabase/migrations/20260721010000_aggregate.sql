-- Per-column summaries, computed over the SAME filtered set as the rows.
--
-- The grid pages, so `records.length` is a subset of the table — summing a column
-- client-side over the loaded window is the same class of lie as the row count
-- fixed in 20260716060000_count_search.sql. This computes the footer totals in
-- Postgres, through the identical WHERE the rows are selected with.
--
-- Modelled line-for-line on swamp_count_records: same catalog, same filter
-- compiler, same search clause. The only new work is turning a map of
-- { "fld_x": "sum", ... } into one SELECT with one aggregate expression per
-- requested column, and returning the answers as { "fld_x": <value>, ... }.
--
-- ── The injection boundary ──
--
-- A caller supplies both the field keys and the aggregation NAMES. The field
-- keys are resolved through swamp_field_catalog, which only ever yields keys that
-- exist on the table — an unknown key raises. The aggregation names are WHITELISTED
-- against the exact same sets the UI gates on (features/tables/types.ts
-- aggregationsFor): the name only SELECTS a fixed SQL template, it is never itself
-- interpolated into SQL. An unknown name — or one not valid for the field's type —
-- raises before it can reach format().
--
-- Group subtotals are out of scope; the shape here (one aggregate SELECT over the
-- filtered set) is what a `group by` variant would extend later.

create or replace function public.swamp_aggregate(
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb,
  p_aggs     jsonb default '{}'::jsonb   -- { "fld_amount": "sum", ... }
)
returns jsonb
language plpgsql stable
as $$
declare
  v_fields  jsonb;
  v_where   text;
  v_key     text;
  v_agg     text;
  v_type    text;
  v_expr    text;
  v_sql     text;
  v_parts   text[] := '{}';
  v_allowed text[];
  v_result  jsonb;

  -- The canonical sets, kept in step with COMMON_/NUMERIC_/BOOLEAN_/DATE_AGGREGATIONS
  -- in features/tables/types.ts.
  v_common  constant text[] := array[
    'count', 'count_empty', 'count_filled', 'count_unique',
    'percent_empty', 'percent_filled'
  ];
  v_numeric constant text[] := array['sum', 'min', 'max', 'avg', 'median'];
  v_boolean constant text[] := array['checked', 'unchecked', 'percent_checked'];
  v_date    constant text[] := array['earliest', 'latest'];
begin
  v_fields := public.swamp_field_catalog(p_table_id);

  if v_fields is null or v_fields = '{}'::jsonb then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  -- Nothing requested: nothing to compute. No query at all.
  if p_aggs is null or p_aggs = '{}'::jsonb then
    return '{}'::jsonb;
  end if;

  -- The SAME predicate the rows are selected with — filter and search both — so the
  -- footer describes exactly the set on screen.
  v_where := format('r.table_id = %L::uuid and r.deleted_at is null', p_table_id);

  if p_spec ? 'filter' then
    v_where := v_where || ' and ' || public.swamp_compile_filter(p_spec->'filter', v_fields);
  end if;

  if p_spec ? 'search' then
    v_where := v_where || ' and ' || public.swamp_search_clause(p_spec->>'search', v_fields);
  end if;

  for v_key, v_agg in select key, value from jsonb_each_text(p_aggs)
  loop
    -- An unknown field: raise, don't guess. The catalog is the whitelist of keys.
    if not (v_fields ? v_key) then
      raise exception 'swamp: unknown field % in aggregation request', v_key;
    end if;

    v_type := v_fields->v_key->>'type';
    v_expr := v_fields->v_key->>'expr';

    -- Which names are legal for THIS field's type — the SQL mirror of aggregationsFor.
    v_allowed := v_common;
    if public.swamp_is_numeric_type(v_type) then
      v_allowed := v_allowed || v_numeric;
    elsif public.swamp_is_temporal_type(v_type) then
      v_allowed := v_allowed || v_date;
    elsif v_type = 'boolean' then
      v_allowed := v_allowed || v_boolean;
    end if;

    if not (v_agg = any(v_allowed)) then
      raise exception 'swamp: aggregation % is not valid for field % of type %',
        v_agg, v_key, v_type;
    end if;

    -- The whitelisted name picks a FIXED template. Only v_expr — which comes from
    -- the trusted catalog, never from the caller — is interpolated.
    v_sql := case v_agg
      when 'count'           then 'count(*)'
      when 'count_filled'    then format('count(*) filter (where nullif((%s)::text, %L) is not null)', v_expr, '')
      when 'count_empty'     then format('count(*) filter (where nullif((%s)::text, %L) is null)', v_expr, '')
      when 'count_unique'    then format('count(distinct %s)', v_expr)
      when 'percent_filled'  then format(
        'case when count(*) = 0 then 0 else round(count(*) filter (where nullif((%s)::text, %L) is not null)::numeric * 100 / count(*), 1) end',
        v_expr, '')
      when 'percent_empty'   then format(
        'case when count(*) = 0 then 0 else round(count(*) filter (where nullif((%s)::text, %L) is null)::numeric * 100 / count(*), 1) end',
        v_expr, '')
      when 'sum'             then format('sum(%s)', v_expr)
      when 'min'             then format('min(%s)', v_expr)
      when 'max'             then format('max(%s)', v_expr)
      when 'avg'             then format('avg(%s)', v_expr)
      when 'median'          then format('percentile_cont(0.5) within group (order by %s)', v_expr)
      when 'earliest'        then format('min(%s)', v_expr)
      when 'latest'          then format('max(%s)', v_expr)
      when 'checked'         then format('count(*) filter (where (%s) is true)', v_expr)
      when 'unchecked'       then format('count(*) filter (where (%s) is not true)', v_expr)
      when 'percent_checked' then format(
        'case when count(*) = 0 then 0 else round(count(*) filter (where (%s) is true)::numeric * 100 / count(*), 1) end',
        v_expr)
    end;

    v_parts := v_parts || format('%L, %s', v_key, v_sql);
  end loop;

  execute format(
    'select jsonb_build_object(%s) from public.records r where %s',
    array_to_string(v_parts, ', '),
    v_where
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end
$$;

-- Called ONLY from the session-authed /api/tables/[id]/aggregate route, never from
-- the anonymous public client. Strip the default PUBLIC grant so it stays off the
-- anon surface, and hand execute to signed-in users and the service role — the
-- convention the session-scoped functions follow (swamp_duplicate_table, the token
-- functions), not the anon api_* ones.
revoke all on function public.swamp_aggregate(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.swamp_aggregate(uuid, jsonb, jsonb) to authenticated, service_role;
