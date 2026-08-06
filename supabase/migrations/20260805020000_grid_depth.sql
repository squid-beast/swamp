-- Grid depth: field-to-field filters + conditional row colours.
--
-- 1. `valueField` on a filter leaf — "Actual > Forecast". The filters table has
--    carried value_field_id since 20260714010000; this is the first code that
--    reads it. Comparison operators only; rhs coerced to the LEFT field's type
--    family so a mismatched pair can never raise. Because webhook conditions use
--    the same compiler (swamp_record_matches), "notify when Actual > Forecast"
--    works with zero webhook changes. Full restatement of the Phase-2 version.
--
-- 2. swamp_row_colors — evaluate up to 5 colour rules over a page of record
--    ids, first match wins. The rules are filter trees compiled by the SAME
--    swamp_compile_filter (there is deliberately no JS filter evaluator).
--    SECURITY INVOKER: the SELECT inside sees exactly what the caller's RLS
--    allows, same as swamp_query_records.
--
--    NEVER exposed on the shared path: a colour rule over a hidden field is the
--    blind-oracle leak the sharing migration closed (filter by salary, read the
--    answer off the colour).

create or replace function public.swamp_compile_filter(
  p_node   jsonb,
  p_fields jsonb,          -- { key: { type, expr } }
  p_depth  int default 0
)
returns text
language plpgsql stable
as $$
declare
  v_op    text;
  v_child jsonb;
  v_parts text[] := '{}';
  v_key   text;
  v_type  text;
  v_expr  text;
  v_value jsonb;
  v_sub   text;
  v_n     int;
  v_range tstzrange;
  v_vkey  text;
  v_rhs   text;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then
    return 'true';
  end if;

  if p_depth > 10 then
    raise exception 'swamp: filter nested too deep (max 10)';
  end if;

  v_op := lower(coalesce(p_node->>'op', ''));

  if p_node ? 'children' then
    if v_op not in ('and', 'or', 'not') then
      raise exception 'swamp: bad group operator %', v_op;
    end if;

    for v_child in select * from jsonb_array_elements(p_node->'children')
    loop
      v_parts := v_parts || public.swamp_compile_filter(v_child, p_fields, p_depth + 1);
    end loop;

    if array_length(v_parts, 1) is null then
      return 'true';
    end if;
    if v_op = 'not' then
      return format('(not (%s))', array_to_string(v_parts, ' and '));
    end if;
    return format('(%s)', array_to_string(v_parts, ' ' || v_op || ' '));
  end if;

  v_key := p_node->>'field';
  if v_key is null or not (p_fields ? v_key) then
    raise exception 'swamp: unknown field %', coalesce(v_key, '(null)');
  end if;

  v_type  := p_fields->v_key->>'type';
  v_expr  := '(' || (p_fields->v_key->>'expr') || ')';
  v_value := p_node->'value';
  v_sub   := p_node->>'subOp';
  v_n     := nullif(p_node->>'n', '')::int;
  v_vkey  := p_node->>'valueField';

  -- Field-to-field comparison: the right-hand side is ANOTHER field's value,
  -- resolved through the SAME p_fields map — a key the client invents is not in
  -- the catalog and cannot reach SQL. The rhs is coerced into the LEFT field's
  -- type family via the safe converters (NULL on garbage, never an exception),
  -- because `numeric > text` would otherwise throw and take the query with it.
  if v_vkey is not null then
    if not (p_fields ? v_vkey) then
      raise exception 'swamp: unknown field %', v_vkey;
    end if;
    if v_op not in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte') then
      raise exception 'swamp: operator % does not support a field comparison', v_op;
    end if;
    if public.swamp_is_numeric_type(v_type) then
      v_rhs := format('public.swamp_to_numeric((%s)::text)', p_fields->v_vkey->>'expr');
    elsif public.swamp_is_temporal_type(v_type) then
      v_rhs := format('public.swamp_to_timestamptz((%s)::text)', p_fields->v_vkey->>'expr');
    elsif v_type = 'boolean' then
      v_rhs := format('public.swamp_to_bool((%s)::text)', p_fields->v_vkey->>'expr');
    else
      v_rhs := format('((%s)::text)', p_fields->v_vkey->>'expr');
    end if;
  end if;

  case v_op
    when 'empty' then
      return format('(%s is null or %s::text = %L)', v_expr, v_expr, '');
    when 'notempty' then
      return format('(%s is not null and %s::text <> %L)', v_expr, v_expr, '');

    when 'eq' then
      if v_rhs is not null then
        return format('(%s = %s)', v_expr, v_rhs);
      end if;
      if public.swamp_is_temporal_type(v_type) and v_sub is not null then
        v_range := public.swamp_date_window(v_sub, v_n);
        if v_range is null then
          return format('(date_trunc(%L, %s) = date_trunc(%L, %s))',
                        'day', v_expr, 'day', public.swamp_literal(v_value, v_type));
        end if;
        return format('(%s >= %L and %s < %L)', v_expr, lower(v_range), v_expr, upper(v_range));
      end if;
      return format('(%s = %s)', v_expr, public.swamp_literal(v_value, v_type));

    when 'neq' then
      return format('(%s is distinct from %s)', v_expr,
                    coalesce(v_rhs, public.swamp_literal(v_value, v_type)));

    when 'gt'  then return format('(%s > %s)',  v_expr, coalesce(v_rhs, public.swamp_literal(v_value, v_type)));
    when 'gte' then return format('(%s >= %s)', v_expr, coalesce(v_rhs, public.swamp_literal(v_value, v_type)));
    when 'lt'  then return format('(%s < %s)',  v_expr, coalesce(v_rhs, public.swamp_literal(v_value, v_type)));
    when 'lte' then return format('(%s <= %s)', v_expr, coalesce(v_rhs, public.swamp_literal(v_value, v_type)));

    when 'btw' then
      return format('(%s between %s and %s)', v_expr,
                    public.swamp_literal(v_value->0, v_type),
                    public.swamp_literal(v_value->1, v_type));

    when 'nbtw' then
      return format('(%s is null or %s not between %s and %s)', v_expr, v_expr,
                    public.swamp_literal(v_value->0, v_type),
                    public.swamp_literal(v_value->1, v_type));

    when 'iswithin' then
      v_range := public.swamp_date_window(v_sub, v_n);
      if v_range is null then
        raise exception 'swamp: isWithin needs a valid subOp, got %', coalesce(v_sub, '(null)');
      end if;
      return format('(%s >= %L and %s < %L)', v_expr, lower(v_range), v_expr, upper(v_range));

    when 'like' then
      return format('(%s::text ilike %L)', v_expr, '%' || (v_value #>> '{}') || '%');
    when 'nlike' then
      return format('(%s is null or %s::text not ilike %L)', v_expr, v_expr,
                    '%' || (v_value #>> '{}') || '%');

    when 'anyof' then
      if v_type in ('multiSelect', 'lookup', 'link') then
        return format('(%s ?| %s)', v_expr, public.swamp_text_array(v_value));
      end if;
      return format('(%s::text = any(%s))', v_expr, public.swamp_text_array(v_value));

    when 'nanyof' then
      if v_type in ('multiSelect', 'lookup', 'link') then
        return format('(%s is null or not (%s ?| %s))', v_expr, v_expr,
                      public.swamp_text_array(v_value));
      end if;
      return format('(%s is null or not (%s::text = any(%s)))', v_expr, v_expr,
                    public.swamp_text_array(v_value));

    when 'allof' then
      return format('(%s ?& %s)', v_expr, public.swamp_text_array(v_value));
    when 'nallof' then
      return format('(%s is null or not (%s ?& %s))', v_expr, v_expr,
                    public.swamp_text_array(v_value));

    when 'checked'    then return format('(%s is true)', v_expr);
    when 'notchecked' then return format('(%s is not true)', v_expr);

    else
      raise exception 'swamp: unknown operator %', coalesce(v_op, '(null)');
  end case;
end
$$;


create or replace function public.swamp_row_colors(
  p_table_id   uuid,
  p_record_ids uuid[],
  p_rules      jsonb   -- [ { "filter": <tree>, "color": "amber" }, ... ]
)
returns jsonb          -- { record_id: color }
language plpgsql stable
as $$
declare
  v_fields    jsonb;
  v_rule      jsonb;
  v_where     text;
  v_color     text;
  v_matched   uuid[];
  v_remaining uuid[];
  v_out       jsonb := '{}'::jsonb;
  v_i         int := 0;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    return '{}'::jsonb;
  end if;
  if p_record_ids is null or array_length(p_record_ids, 1) is null then
    return '{}'::jsonb;
  end if;

  v_fields := public.swamp_field_catalog(p_table_id);
  if v_fields is null or v_fields = '{}'::jsonb then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  v_remaining := p_record_ids;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    v_i := v_i + 1;
    exit when v_i > 5;  -- ponytail: five rules, first match wins. Enough for a status board.
    exit when array_length(v_remaining, 1) is null;

    v_color := v_rule->>'color';
    if v_color is null then continue; end if;

    -- The injection boundary is the catalog inside swamp_compile_filter, as
    -- everywhere else. The colour is returned as DATA, never interpolated.
    v_where := public.swamp_compile_filter(v_rule->'filter', v_fields);

    execute format(
      'select coalesce(array_agg(r.id), array[]::uuid[]) from public.records r
        where r.table_id = %L::uuid and r.deleted_at is null and r.id = any($1) and %s',
      p_table_id, v_where
    ) using v_remaining into v_matched;

    -- First matching rule wins: matched ids leave the pool.
    v_out := v_out || (
      select coalesce(jsonb_object_agg(m::text, to_jsonb(v_color)), '{}'::jsonb)
        from unnest(v_matched) m
    );
    v_remaining := (
      select coalesce(array_agg(x), array[]::uuid[])
        from unnest(v_remaining) x
       where not (x = any(v_matched))
    );
  end loop;

  return v_out;
end
$$;

-- Session-only, like swamp_aggregate: never anon-reachable. The shared path
-- must not gain colour rules (see the header).
revoke all on function public.swamp_row_colors(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.swamp_row_colors(uuid, uuid[], jsonb) to authenticated, service_role;
