-- Make the row count agree with the rows.
--
-- swamp_count_records applies `filter` and stops (sharing.sql:456-484):
--
--     if p_spec ? 'filter' then
--       v_where := v_where || ' and ' || public.swamp_compile_filter(...);
--     end if;
--     execute format('select count(*) from public.records r where %s', v_where);
--
-- It never applies `search`. swamp_query_records does (platform.sql:1521-1538). So
-- the moment anyone types in the search box, the grid shows the matching rows and a
-- total counted over the whole table: "3 rows" under a list of one. The number has
-- been wrong since search shipped.
--
-- It matters more now than it did. Group-by is next, and group counts that DO
-- honour search would visibly fail to sum to a total that doesn't — turning a quiet
-- wrong number into an obviously broken one.
--
-- ── One definition of "search", not two ──
--
-- The predicate is lifted into a function instead of being copy-pasted into the
-- count. It is already written out once inside swamp_query_records; pasting it here
-- would make two, and the aggregation work would shortly have made three. Three
-- copies of a search rule is three chances for the count, the rows and the subtotals
-- to disagree — which is exactly the bug being fixed.
--
-- swamp_query_records keeps its inline copy for now: adopting this helper there
-- means re-declaring 217 lines of the hottest function in the product to change four,
-- and that trade is not worth it today. Whoever next has a real reason to replace it
-- should swap the block for this call. The two are identical — deliberately, and the
-- test asserts they agree rather than trusting that they do.

create or replace function public.swamp_search_clause(p_search text, p_fields jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_search    text;
  v_key       text;
  v_type      text;
  v_searchers text[] := '{}';
begin
  v_search := nullif(trim(coalesce(p_search, '')), '');
  if v_search is null then
    return 'true';
  end if;

  -- Text-ish fields only. Computed fields are searchable on purpose — a lookup of a
  -- company name should be findable by typing the company name.
  for v_key, v_type in select key, value->>'type' from jsonb_each(p_fields)
  loop
    if not public.swamp_is_numeric_type(v_type)
       and not public.swamp_is_temporal_type(v_type)
       and v_type not in ('boolean', 'rollup', 'count')
    then
      v_searchers := v_searchers || format(
        '((%s)::text ilike %L)', p_fields->v_key->>'expr', '%' || v_search || '%'
      );
    end if;
  end loop;

  -- A search over a table with nothing searchable matches nothing, rather than
  -- everything. `coalesce(null, 'false')` is doing real work here.
  return coalesce('(' || array_to_string(v_searchers, ' or ') || ')', 'false');
end
$$;

revoke all on function public.swamp_search_clause(text, jsonb) from public;
revoke all on function public.swamp_search_clause(text, jsonb) from anon;
grant execute on function public.swamp_search_clause(text, jsonb) to authenticated;

-- Everything below is verbatim from 20260714070000_sharing.sql:456-484 except the
-- three lines that apply the search.
create or replace function public.swamp_count_records(
  p_table_id uuid,
  p_spec     jsonb  default '{}'::jsonb,
  p_only     text[] default null
)
returns bigint
language plpgsql stable
as $$
declare
  v_fields jsonb;
  v_where  text;
  v_count  bigint;
begin
  v_fields := public.swamp_field_catalog(p_table_id, p_only);

  if v_fields is null or v_fields = '{}'::jsonb then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  v_where := format('r.table_id = %L::uuid and r.deleted_at is null', p_table_id);

  if p_spec ? 'filter' then
    v_where := v_where || ' and ' || public.swamp_compile_filter(p_spec->'filter', v_fields);
  end if;

  -- The fix. Same predicate the rows are selected with, so the number describes
  -- what is on screen.
  if p_spec ? 'search' then
    v_where := v_where || ' and ' || public.swamp_search_clause(p_spec->>'search', v_fields);
  end if;

  execute format('select count(*) from public.records r where %s', v_where) into v_count;
  return v_count;
end
$$;
