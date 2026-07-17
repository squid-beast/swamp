-- Group-by: the group list.
--
-- The headline gap against Airtable, and the one place swamp had the vocabulary and
-- no engine: view_fields.group_by / group_by_order / group_by_dir have existed since
-- workspace_schema.sql:382-384, loadViewConfig READS them, saveViewFields never
-- wrote them, and table-workspace hardcoded groupBy:false. Write-only-false.
--
-- ── What this function is, and what it deliberately is not ──
--
-- It answers ONE question: for this table, under this filter and search, what are
-- the distinct values of this field and how many records does each have? That is
-- the group HEADERS.
--
-- It does not return rows. Rows for an expanded group come from the existing
-- swamp_query_records with an ordinary `eq` filter on the group value ANDed onto the
-- view's own filter — which means:
--
--   * the keyset cursor works inside a group, unchanged, because it is just a query
--     with one more filter;
--   * a COLLAPSED group costs nothing at all — its rows are never fetched, which is
--     the entire point of collapsing and the thing a "sort by the group field and
--     render a header when it changes" design cannot do (you would still page
--     through 10,000 rows of a group you closed);
--   * swamp_query_records — 217 lines and the hottest function in the product — is
--     not touched.
--
-- The cost is one query per expanded group. That is the trade, and it is the right
-- way round: it scales with what you are LOOKING at rather than with the table.
--
-- ── Why grouping is restricted to scalars ──
--
-- A group is only useful if you can then ask for its rows, and that ask is an `eq`
-- filter. `eq` on a multiSelect or a link is not a group membership test — those
-- hold jsonb arrays, and their exprs coalesce to '[]' rather than NULL, so a record
-- with no links would bucket under the string "[]" rather than under the empty
-- group. Restricting to scalars keeps one meaning of "this row is in that group"
-- instead of two. The field dialog offers the same list; this is the half that is
-- enforced.

create or replace function public.swamp_group_counts(
  p_table_id uuid,
  p_spec     jsonb  default '{}'::jsonb,
  p_field    text   default null,
  p_dir      text   default 'asc',
  p_limit    int    default 200,
  p_only     text[] default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_fields jsonb;
  v_type   text;
  v_expr   text;
  v_where  text;
  v_dir    text;
  v_limit  int;
  v_sql    text;
  v_out    jsonb;
begin
  v_fields := public.swamp_field_catalog(p_table_id, p_only);

  if v_fields is null or v_fields = '{}'::jsonb then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  -- THE INJECTION BOUNDARY. p_field is a client string; it may only ever be used
  -- after it has been found in the catalog, and what reaches the SQL is the
  -- catalog's own expression, never the caller's text.
  if p_field is null or not (v_fields ? p_field) then
    raise exception 'swamp: cannot group by unknown field %', coalesce(p_field, '(null)');
  end if;

  v_type := v_fields->p_field->>'type';
  v_expr := '(' || (v_fields->p_field->>'expr') || ')';

  -- Same list the field dialog offers. A group you cannot then filter to is not a
  -- group; see the note above.
  if v_type not in (
    'text', 'longText', 'email', 'phone', 'url', 'uuid', 'color',
    'singleSelect', 'status', 'boolean',
    'number', 'currency', 'percent', 'rating', 'year', 'duration',
    'date', 'datetime', 'time',
    'formula', 'lookup', 'rollup', 'count',
    'createdBy', 'modifiedBy', 'createdTime', 'modifiedTime'
  ) then
    raise exception 'swamp: cannot group by a % field', v_type;
  end if;

  -- Whitelisted, not interpolated.
  v_dir   := case lower(coalesce(p_dir, 'asc')) when 'desc' then 'desc' else 'asc' end;
  v_limit := least(greatest(coalesce(p_limit, 200), 1), 1000);

  v_where := format('r.table_id = %L::uuid and r.deleted_at is null', p_table_id);

  if p_spec ? 'filter' then
    v_where := v_where || ' and ' || public.swamp_compile_filter(p_spec->'filter', v_fields);
  end if;

  -- The counts describe the same rows the grid is showing. A group list that
  -- ignored the filter would sum to more than the total and read as a bug.
  if p_spec ? 'search' then
    v_where := v_where || ' and ' || public.swamp_search_clause(p_spec->>'search', v_fields);
  end if;

  v_sql := format($q$
    select coalesce(jsonb_agg(x order by rn), '[]'::jsonb)
      from (
        select jsonb_build_object('value', to_jsonb(%s), 'count', count(*)) as x,
               row_number() over (order by %s %s nulls last) as rn
          from public.records r
         where %s
         group by %s
         order by %s %s nulls last
         limit %s
      ) s
  $q$, v_expr, v_expr, v_dir, v_where, v_expr, v_expr, v_dir, v_limit);

  execute v_sql into v_out;
  return v_out;
end
$$;

revoke all on function public.swamp_group_counts(uuid, jsonb, text, text, int, text[]) from public;
revoke all on function public.swamp_group_counts(uuid, jsonb, text, text, int, text[]) from anon;
grant execute on function public.swamp_group_counts(uuid, jsonb, text, text, int, text[]) to authenticated;

do $$
begin
  assert not has_function_privilege('anon', 'public.swamp_group_counts(uuid,jsonb,text,text,int,text[])', 'execute'),
         'anon must not reach swamp_group_counts';
end $$;
