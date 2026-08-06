-- Formula library expansion + `nbtw` operator + four aggregations.
--
-- Mirrors of features/tables/{formula/functions.ts, types.ts} — the TS lists and
-- these SQL arms agreeing is a correctness property. A name in TS with no arm
-- here produces a formula that parses and then computes NULL (swamp_field_catalog
-- swallows per-formula exceptions across passes), which is why the integration
-- tests assert VALUES, not absence of error.
--
-- Regex functions note: a user-supplied pattern is a ReDoS surface (Postgres
-- backtracks). The bound is the platform statement_timeout Supabase applies per
-- role; no extra guard here.
--
-- `create or replace` preserves each function's existing ACL. Only the two NEW
-- helpers need their own revoke/grant (see the bottom, and anon-surface.test.ts).

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- Percent-encode for URLs. RFC 3986 unreserved characters pass through.
create or replace function public.swamp_urlencode(t text)
returns text
language sql immutable parallel safe
as $$
  select coalesce(string_agg(
    case when c ~ '[A-Za-z0-9_.~-]' then c
         else regexp_replace(upper(encode(convert_to(c, 'UTF8'), 'hex')), '(..)', '%\1', 'g')
    end, ''), '')
  from regexp_split_to_table(coalesce(t, ''), '') as c
$$;

-- Parse text as a jsonb ARRAY, or NULL. The guard that lets the ARRAY*/COUNTA
-- functions accept anything without a bad cast killing the whole query — the
-- same design rule as swamp_num.
create or replace function public.swamp_jsonb_arr(t text)
returns jsonb
language plpgsql immutable parallel safe
as $$
declare v jsonb;
begin
  v := t::jsonb;
  if jsonb_typeof(v) = 'array' then return v; end if;
  return null;
exception when others then
  return null;
end
$$;

-- ─── The function library ───────────────────────────────────────────────────
--
-- Full restatement of 20260714060000_relational.sql's version, with the
-- NocoDB-parity arms appended per section.

create or replace function public.swamp_formula_fn(p_fn text, p_args text[])
returns text
language plpgsql immutable
as $$
declare
  n int := coalesce(array_length(p_args, 1), 0);
  v_sql text;
  i int;
begin
  case p_fn
    -- ── Logic ──
    when 'IF' then
      if n < 2 then raise exception 'swamp: IF needs at least 2 arguments'; end if;
      return format('(case when coalesce(%s::boolean, false) then %s else %s end)',
                    p_args[1], p_args[2],
                    case when n >= 3 then p_args[3] else 'null' end);

    when 'AND' then return '(' || array_to_string(
      (select array_agg(format('coalesce(%s::boolean, false)', a)) from unnest(p_args) a), ' and ') || ')';
    when 'OR' then return '(' || array_to_string(
      (select array_agg(format('coalesce(%s::boolean, false)', a)) from unnest(p_args) a), ' or ') || ')';
    when 'NOT' then return format('(not coalesce(%s::boolean, false))', p_args[1]);

    when 'BLANK' then return 'null';
    when 'ISBLANK' then
      return format('(%s is null or %s::text = '''')', p_args[1], p_args[1]);
    when 'ISNOTBLANK' then
      return format('(%s is not null and %s::text <> '''')', p_args[1], p_args[1]);

    when 'SWITCH' then
      -- SWITCH(value, pattern, result, ..., [default]). Folded to one CASE on
      -- the value's text form. An odd trailing argument is the default.
      if n < 3 then raise exception 'swamp: SWITCH needs at least 3 arguments'; end if;
      v_sql := format('(case %s::text', p_args[1]);
      i := 2;
      while i + 1 <= n loop
        v_sql := v_sql || format(' when %s::text then %s', p_args[i], p_args[i + 1]);
        i := i + 2;
      end loop;
      if i = n then
        v_sql := v_sql || format(' else %s', p_args[n]);
      end if;
      return v_sql || ' end)';

    when 'XOR' then
      -- True when an odd number of arguments are true.
      return '(((' || array_to_string(
        (select array_agg(format('(coalesce(%s::boolean, false))::int', a)) from unnest(p_args) a),
        ' + ') || ') % 2) = 1)';

    -- ── Text ──
    when 'CONCAT' then
      return '(' || array_to_string(
        (select array_agg(format('coalesce(%s::text, '''')', a)) from unnest(p_args) a), ' || ') || ')';
    when 'UPPER'  then return format('upper(%s::text)', p_args[1]);
    when 'LOWER'  then return format('lower(%s::text)', p_args[1]);
    when 'TRIM'   then return format('trim(%s::text)', p_args[1]);
    when 'LEN'    then return format('length(coalesce(%s::text, ''''))', p_args[1]);
    when 'LEFT'   then return format('left(%s::text, public.swamp_num(%s)::int)', p_args[1], p_args[2]);
    when 'RIGHT'  then return format('right(%s::text, public.swamp_num(%s)::int)', p_args[1], p_args[2]);
    when 'MID'    then return format('substring(%s::text from public.swamp_num(%s)::int for public.swamp_num(%s)::int)',
                                     p_args[1], p_args[2], p_args[3]);
    when 'REPLACE' then return format('replace(%s::text, %s::text, %s::text)', p_args[1], p_args[2], p_args[3]);
    when 'SEARCH' then return format('nullif(position(%s::text in %s::text), 0)', p_args[2], p_args[1]);

    when 'REPEAT' then
      return format('repeat(%s::text, greatest(public.swamp_num(%s::text)::int, 0))', p_args[1], p_args[2]);
    when 'URLENCODE' then
      return format('public.swamp_urlencode(%s::text)', p_args[1]);
    when 'REGEX_MATCH' then
      return format('(%s::text ~ %s::text)', p_args[1], p_args[2]);
    when 'REGEX_EXTRACT' then
      return format('substring(%s::text from %s::text)', p_args[1], p_args[2]);
    when 'REGEX_REPLACE' then
      return format('regexp_replace(%s::text, %s::text, %s::text, ''g'')',
                    p_args[1], p_args[2], p_args[3]);
    when 'MD5' then
      -- md5() is a core builtin. SHA256 is deliberately absent: digest() lives
      -- in pgcrypto, whose schema differs between local (public) and hosted
      -- (extensions), and this function does not pin a search_path.
      return format('md5(%s::text)', p_args[1]);

    -- ── Numbers ──
    when 'ABS'     then return format('abs(public.swamp_num(%s))', p_args[1]);
    when 'ROUND'   then return format('round(public.swamp_num(%s), %s)', p_args[1],
                                      case when n >= 2 then format('public.swamp_num(%s)::int', p_args[2]) else '0' end);
    when 'CEILING' then return format('ceil(public.swamp_num(%s))', p_args[1]);
    when 'FLOOR'   then return format('floor(public.swamp_num(%s))', p_args[1]);
    when 'SQRT'    then return format('sqrt(public.swamp_num(%s))', p_args[1]);
    when 'POWER'   then return format('power(public.swamp_num(%s), public.swamp_num(%s))', p_args[1], p_args[2]);
    when 'MOD'     then return format('mod(public.swamp_num(%s), nullif(public.swamp_num(%s), 0))', p_args[1], p_args[2]);

    when 'MIN' then return 'least(' || array_to_string(
      (select array_agg(format('public.swamp_num(%s)', a)) from unnest(p_args) a), ', ') || ')';
    when 'MAX' then return 'greatest(' || array_to_string(
      (select array_agg(format('public.swamp_num(%s)', a)) from unnest(p_args) a), ', ') || ')';

    when 'EVEN' then
      -- Away from zero to the nearest even integer. EVEN(1) = 2, EVEN(-1) = -2.
      return format('(sign(public.swamp_num(%s::text)) * ceil(abs(public.swamp_num(%s::text)) / 2) * 2)',
                    p_args[1], p_args[1]);
    when 'ODD' then
      -- Away from zero to the nearest odd integer. ODD(2) = 3, ODD(-2) = -3.
      return format(
        '(case when public.swamp_num(%s::text) = 0 then 1 else sign(public.swamp_num(%s::text)) * (2 * ceil((abs(public.swamp_num(%s::text)) + 1) / 2) - 1) end)',
        p_args[1], p_args[1], p_args[1]);
    when 'ROUNDDOWN' then
      return format('trunc(public.swamp_num(%s::text), %s)', p_args[1],
                    case when n >= 2 then format('public.swamp_num(%s::text)::int', p_args[2]) else '0' end);
    when 'ROUNDUP' then
      -- Away from zero: ceil for positive, floor for negative, scaled by places.
      v_sql := case when n >= 2 then format('public.swamp_num(%s::text)::int', p_args[2]) else '0' end;
      return format(
        '(case when public.swamp_num(%1$s::text) >= 0 then ceil(public.swamp_num(%1$s::text) * power(10, %2$s)) / power(10, %2$s) else floor(public.swamp_num(%1$s::text) * power(10, %2$s)) / power(10, %2$s) end)',
        p_args[1], v_sql);
    when 'INT'   then return format('floor(public.swamp_num(%s::text))', p_args[1]);
    when 'VALUE' then return format('public.swamp_num(%s::text)', p_args[1]);
    when 'LOG' then
      -- log(base, n); base 10 unless given. Non-positive input → NULL, not error.
      return format('log(nullif(%s, 0)::numeric, nullif(greatest(public.swamp_num(%s::text), 0), 0))',
                    case when n >= 2 then format('greatest(public.swamp_num(%s::text), 0)', p_args[2]) else '10' end,
                    p_args[1]);
    when 'EXP' then return format('exp(public.swamp_num(%s::text))', p_args[1]);

    -- ── Arrays ──
    -- Inputs go through swamp_jsonb_arr: a non-array value degrades to NULL/[]
    -- instead of a cast error taking the page down.
    when 'ARRAYUNIQUE' then
      return format(
        '(select jsonb_agg(distinct e) from jsonb_array_elements(coalesce(public.swamp_jsonb_arr(%s::text), ''[]''::jsonb)) e)',
        p_args[1]);
    when 'ARRAYSORT' then
      return format(
        '(select jsonb_agg(e order by e) from jsonb_array_elements(coalesce(public.swamp_jsonb_arr(%s::text), ''[]''::jsonb)) e)',
        p_args[1]);
    when 'ARRAYCOMPACT' then
      return format(
        '(select jsonb_agg(e) from jsonb_array_elements(coalesce(public.swamp_jsonb_arr(%s::text), ''[]''::jsonb)) e where e <> ''null''::jsonb and e <> ''""''::jsonb)',
        p_args[1]);
    when 'ARRAYSLICE' then
      return format(
        '(select jsonb_agg(e) from (select e, row_number() over () rn from jsonb_array_elements(coalesce(public.swamp_jsonb_arr(%s::text), ''[]''::jsonb)) e) s where s.rn between public.swamp_num(%s::text)::int and public.swamp_num(%s::text)::int)',
        p_args[1], p_args[2], p_args[3]);

    when 'COUNTA' then
      -- Non-empty count. A single array argument counts its items — that is
      -- what COUNTA of a lookup should mean.
      return '(' || array_to_string(
        (select array_agg(format(
          'coalesce(jsonb_array_length(public.swamp_jsonb_arr(%1$s::text)), case when %1$s is null or %1$s::text = '''' then 0 else 1 end)',
          a)) from unnest(p_args) a), ' + ') || ')';
    when 'COUNT' then
      return '(' || array_to_string(
        (select array_agg(format('(case when public.swamp_num(%s::text) is not null then 1 else 0 end)', a))
           from unnest(p_args) a), ' + ') || ')';
    when 'COUNTALL' then
      return format('%s', n);

    -- ── Dates ──
    when 'NOW'   then return 'now()';
    when 'TODAY' then return 'date_trunc(''day'', now())';
    when 'YEAR'  then return format('extract(year  from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'MONTH' then return format('extract(month from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'DAY'   then return format('extract(day   from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'WEEKDAY' then return format('extract(dow from public.swamp_to_timestamptz(%s::text))', p_args[1]);

    when 'DATEADD' then
      return format(
        '(public.swamp_to_timestamptz(%s::text) + make_interval(days => public.swamp_num(%s)::int))',
        p_args[1], p_args[2]);

    when 'DATEDIFF' then
      return format(
        'extract(day from (public.swamp_to_timestamptz(%s::text) - public.swamp_to_timestamptz(%s::text)))',
        p_args[1], p_args[2]);

    when 'DATEFORMAT' then
      return format('to_char(public.swamp_to_timestamptz(%s::text), %s::text)', p_args[1], p_args[2]);

    when 'DATETIME_DIFF' then
      -- The unit is a runtime value (usually a literal): branch in SQL, not here.
      return format(
        $sql$(case lower(coalesce(%3$s::text, 'days'))
          when 'seconds' then extract(epoch from (public.swamp_to_timestamptz(%1$s::text) - public.swamp_to_timestamptz(%2$s::text)))
          when 'minutes' then extract(epoch from (public.swamp_to_timestamptz(%1$s::text) - public.swamp_to_timestamptz(%2$s::text))) / 60
          when 'hours'   then extract(epoch from (public.swamp_to_timestamptz(%1$s::text) - public.swamp_to_timestamptz(%2$s::text))) / 3600
          when 'days'    then extract(epoch from (public.swamp_to_timestamptz(%1$s::text) - public.swamp_to_timestamptz(%2$s::text))) / 86400
          when 'weeks'   then extract(epoch from (public.swamp_to_timestamptz(%1$s::text) - public.swamp_to_timestamptz(%2$s::text))) / 604800
          when 'months'  then (extract(year from age(public.swamp_to_timestamptz(%1$s::text), public.swamp_to_timestamptz(%2$s::text))) * 12
                               + extract(month from age(public.swamp_to_timestamptz(%1$s::text), public.swamp_to_timestamptz(%2$s::text))))
          when 'years'   then extract(year from age(public.swamp_to_timestamptz(%1$s::text), public.swamp_to_timestamptz(%2$s::text)))
          else null
        end)$sql$,
        p_args[1], p_args[2],
        case when n >= 3 then p_args[3] else quote_literal('days') end);

    when 'HOUR'   then return format('extract(hour   from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'MINUTE' then return format('extract(minute from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'SECOND' then return format('floor(extract(second from public.swamp_to_timestamptz(%s::text)))', p_args[1]);

    -- ── Record ──
    when 'RECORD_ID' then return 'r.id::text';

    else
      raise exception 'swamp: unknown function %', coalesce(p_fn, '(null)');
  end case;
end
$$;

-- ─── nbtw ───────────────────────────────────────────────────────────────────
--
-- Full restatement of the 20260714060000_relational.sql version, plus the
-- `nbtw` arm — NULL-safe like `neq`/`nanyof`: a blank cell IS "not between".

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

  case v_op
    when 'empty' then
      return format('(%s is null or %s::text = %L)', v_expr, v_expr, '');
    when 'notempty' then
      return format('(%s is not null and %s::text <> %L)', v_expr, v_expr, '');

    when 'eq' then
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
      return format('(%s is distinct from %s)', v_expr, public.swamp_literal(v_value, v_type));

    when 'gt'  then return format('(%s > %s)',  v_expr, public.swamp_literal(v_value, v_type));
    when 'gte' then return format('(%s >= %s)', v_expr, public.swamp_literal(v_value, v_type));
    when 'lt'  then return format('(%s < %s)',  v_expr, public.swamp_literal(v_value, v_type));
    when 'lte' then return format('(%s <= %s)', v_expr, public.swamp_literal(v_value, v_type));

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

-- ─── Aggregations: std_dev, range, percent_unique, date_range ───────────────
--
-- Full restatement of 20260721010000_aggregate.sql, whitelists and templates
-- extended in step with types.ts.

create or replace function public.swamp_aggregate(
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb,
  p_aggs     jsonb default '{}'::jsonb
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

  v_common  constant text[] := array[
    'count', 'count_empty', 'count_filled', 'count_unique',
    'percent_empty', 'percent_filled', 'percent_unique'
  ];
  v_numeric constant text[] := array['sum', 'min', 'max', 'avg', 'median', 'std_dev', 'range'];
  v_boolean constant text[] := array['checked', 'unchecked', 'percent_checked'];
  v_date    constant text[] := array['earliest', 'latest', 'date_range'];
begin
  v_fields := public.swamp_field_catalog(p_table_id);

  if v_fields is null or v_fields = '{}'::jsonb then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  if p_aggs is null or p_aggs = '{}'::jsonb then
    return '{}'::jsonb;
  end if;

  v_where := format('r.table_id = %L::uuid and r.deleted_at is null', p_table_id);

  if p_spec ? 'filter' then
    v_where := v_where || ' and ' || public.swamp_compile_filter(p_spec->'filter', v_fields);
  end if;

  if p_spec ? 'search' then
    v_where := v_where || ' and ' || public.swamp_search_clause(p_spec->>'search', v_fields);
  end if;

  for v_key, v_agg in select key, value from jsonb_each_text(p_aggs)
  loop
    if not (v_fields ? v_key) then
      raise exception 'swamp: unknown field % in aggregation request', v_key;
    end if;

    v_type := v_fields->v_key->>'type';
    v_expr := v_fields->v_key->>'expr';

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
      when 'percent_unique'  then format(
        'case when count(*) = 0 then 0 else round(count(distinct %s)::numeric * 100 / count(*), 1) end',
        v_expr)
      when 'sum'             then format('sum(%s)', v_expr)
      when 'min'             then format('min(%s)', v_expr)
      when 'max'             then format('max(%s)', v_expr)
      when 'avg'             then format('avg(%s)', v_expr)
      when 'median'          then format('percentile_cont(0.5) within group (order by %s)', v_expr)
      when 'std_dev'         then format('stddev_samp(%s)', v_expr)
      when 'range'           then format('(max(%s) - min(%s))', v_expr, v_expr)
      when 'earliest'        then format('min(%s)', v_expr)
      when 'latest'          then format('max(%s)', v_expr)
      when 'date_range'      then format('extract(day from (max(%s) - min(%s)))', v_expr, v_expr)
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

-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- The two NEW helpers. They are only ever called from inside SQL that other
-- swamp functions build — nothing calls them from a client — so: strip the
-- default PUBLIC grant, execute for authenticated (whose queries embed them via
-- swamp_query_records, SECURITY INVOKER) and service_role. anon must NOT hold
-- execute directly; the anon-reachable paths (swamp_api_*, swamp_shared_*) are
-- SECURITY DEFINER and run as owner. Replacements above keep their ACLs.

revoke all on function public.swamp_urlencode(text) from public, anon;
grant execute on function public.swamp_urlencode(text) to authenticated, service_role;

revoke all on function public.swamp_jsonb_arr(text) from public, anon;
grant execute on function public.swamp_jsonb_arr(text) to authenticated, service_role;
