-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1b — the query engine.
--
-- A view is a saved (filter tree, sort list, projection). A request may layer
-- ad-hoc filter/sort/search on top. All of it compiles into ONE SQL statement,
-- executed in Postgres.
--
-- The alternative — fetch the rows and filter them in JavaScript — is what SWAMP
-- does today, and it is why the app caps out at 5,000 records with a *silent*
-- truncation. No amount of frontend work fixes that. The filter has to become a
-- WHERE clause.
--
-- ── Why a plpgsql function and not the PostgREST query builder ──
--
-- PostgREST can express `?status=eq.open`. It cannot express an arbitrarily
-- nested and/or/not tree over JSONB with per-field type coercion, date windows
-- resolved at query time, and keyset pagination over a user-defined multi-column
-- sort. Forcing it produces a client that builds SQL by string concatenation
-- over HTTP, which is worse in every way.
--
-- So the compiler lives in the database. The client sends a JSON *spec*. The
-- client never sends SQL.
--
-- ── Safety ──
--
-- This builds dynamic SQL, so every input is hostile until proven otherwise:
--
--   • Field keys are resolved through the `fields` table. A key the client
--     invents is not in the map, so it cannot reach the SQL. That map is the
--     injection boundary.
--   • Operators, directions and sub-operators are matched against whitelists.
--   • Values go through quote_literal, always.
--   • SECURITY INVOKER (the default): the function runs as the caller, so RLS
--     applies exactly as it would to a plain SELECT. A user cannot query a table
--     they cannot read, and we don't have to trust them not to try.
--
-- ── Storage convention this establishes ──
--
--   multiSelect  → a JSON ARRAY:  {"fld_tags": ["a","b"]}
--                  Not a comma-joined string. An array gives real containment
--                  operators and a GIN index; the string gives you LIKE and regret.
--   everything else → a JSON scalar.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Safe casts ─────────────────────────────────────────────────────────────
--
-- `(data->>'k')::numeric` throws on the first cell holding "N/A" — one bad value
-- takes down the whole query. These return NULL instead: a value that isn't a
-- number simply doesn't match a numeric filter, which is what a user expects.
--
-- IMMUTABLE so they can back expression indexes:
--   create index on records ((public.swamp_to_numeric(data->>'fld_amount')));

create function public.swamp_to_numeric(t text)
returns numeric
language plpgsql immutable parallel safe
as $$
begin
  return t::numeric;
exception when others then
  return null;
end
$$;

create function public.swamp_to_timestamptz(t text)
returns timestamptz
language plpgsql immutable parallel safe
as $$
begin
  return t::timestamptz;
exception when others then
  return null;
end
$$;

create function public.swamp_to_bool(t text)
returns boolean
language plpgsql immutable parallel safe
as $$
begin
  return case lower(trim(t))
    when 'true' then true  when 't' then true
    when 'yes'  then true  when 'y' then true
    when '1'    then true
    when 'false' then false when 'f' then false
    when 'no'    then false when 'n' then false
    when '0'     then false
    else null
  end;
end
$$;


-- ─── Type groups + literals ─────────────────────────────────────────────────

create function public.swamp_is_numeric_type(t text)
returns boolean language sql immutable parallel safe as $$
  select t in ('number', 'currency', 'percent', 'rating', 'year', 'duration')
$$;

create function public.swamp_is_temporal_type(t text)
returns boolean language sql immutable parallel safe as $$
  select t in ('date', 'datetime')
$$;

/** A JSON value as a correctly-typed, safely-quoted SQL literal. */
create function public.swamp_literal(p_value jsonb, p_type text)
returns text
language sql immutable parallel safe
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then 'null'
    when public.swamp_is_numeric_type(p_type)
      then quote_literal(p_value #>> '{}') || '::numeric'
    when public.swamp_is_temporal_type(p_type)
      then quote_literal(p_value #>> '{}') || '::timestamptz'
    when p_type = 'boolean'
      then quote_literal(p_value #>> '{}') || '::boolean'
    else quote_literal(p_value #>> '{}')
  end
$$;

/** A JSON array as a safely-quoted SQL text[] literal. A scalar is wrapped. */
create function public.swamp_text_array(p_value jsonb)
returns text
language sql immutable parallel safe
as $$
  select coalesce(
    'array[' || (
      select string_agg(quote_literal(v #>> '{}'), ', ')
        from jsonb_array_elements(
               case jsonb_typeof(p_value)
                 when 'array' then p_value
                 else jsonb_build_array(p_value)
               end
             ) v
    ) || ']::text[]',
    'array[]::text[]'
  )
$$;

/**
 * The SQL expression yielding a field's value, correctly typed.
 * p_key is trusted ONLY because every caller resolves it through the field map.
 */
create function public.swamp_field_expr(p_key text, p_type text)
returns text
language sql immutable parallel safe
as $$
  select case
    when public.swamp_is_numeric_type(p_type)
      then format('public.swamp_to_numeric(r.data->>%L)', p_key)
    when public.swamp_is_temporal_type(p_type)
      then format('public.swamp_to_timestamptz(r.data->>%L)', p_key)
    when p_type = 'boolean'
      then format('public.swamp_to_bool(r.data->>%L)', p_key)
    when p_type = 'multiSelect'
      then format('(r.data->%L)', p_key)      -- jsonb array
    else format('(r.data->>%L)', p_key)       -- text
  end
$$;


-- ─── Relative date windows ──────────────────────────────────────────────────
--
-- This is what makes "due in the next 7 days" a STORED, RELATIVE filter that is
-- re-evaluated on every query rather than a literal frozen at save time. It's the
-- single feature that makes filters feel alive, and it costs almost nothing.
--
-- Half-open [lower, upper). Half-open matters: `< upper` rather than `<= upper`
-- means "today" doesn't quietly include the first instant of tomorrow.

create function public.swamp_date_window(p_sub_op text, p_n int default null)
returns tstzrange
language sql stable parallel safe
as $$
  with d as (select date_trunc('day', now()) as t)
  select case p_sub_op
    when 'today'           then tstzrange(t,                        t + interval '1 day',  '[)')
    when 'tomorrow'        then tstzrange(t + interval '1 day',      t + interval '2 days', '[)')
    when 'yesterday'       then tstzrange(t - interval '1 day',      t,                     '[)')
    when 'oneWeekAgo'      then tstzrange(t - interval '7 days',     t - interval '6 days', '[)')
    when 'oneWeekFromNow'  then tstzrange(t + interval '7 days',     t + interval '8 days', '[)')
    when 'oneMonthAgo'     then tstzrange(t - interval '1 month',    t - interval '1 month' + interval '1 day', '[)')
    when 'oneMonthFromNow' then tstzrange(t + interval '1 month',    t + interval '1 month' + interval '1 day', '[)')
    when 'daysAgo'         then tstzrange(t - make_interval(days => p_n), t - make_interval(days => p_n) + interval '1 day', '[)')
    when 'daysFromNow'     then tstzrange(t + make_interval(days => p_n), t + make_interval(days => p_n) + interval '1 day', '[)')

    -- isWithin ranges. "past" windows include today; "next" windows start today.
    when 'pastWeek'         then tstzrange(t - interval '7 days',  t + interval '1 day', '[)')
    when 'pastMonth'        then tstzrange(t - interval '1 month', t + interval '1 day', '[)')
    when 'pastYear'         then tstzrange(t - interval '1 year',  t + interval '1 day', '[)')
    when 'nextWeek'         then tstzrange(t, t + interval '8 days', '[)')
    when 'nextMonth'        then tstzrange(t, t + interval '1 month' + interval '1 day', '[)')
    when 'nextYear'         then tstzrange(t, t + interval '1 year' + interval '1 day', '[)')
    when 'pastNumberOfDays' then tstzrange(t - make_interval(days => p_n), t + interval '1 day', '[)')
    when 'nextNumberOfDays' then tstzrange(t, t + make_interval(days => p_n) + interval '1 day', '[)')
    else null
  end
  from d
$$;


-- ─── Filter compiler ────────────────────────────────────────────────────────
--
-- GROUP: { "op": "and"|"or"|"not", "children": [ ... ] }
-- LEAF:  { "field": "fld_x", "op": "gt", "value": 100, "subOp": "today", "n": 7 }
--
-- Depth-capped: a client-supplied tree is client-controlled input, and
-- "nest it 10,000 deep" is otherwise a free stack overflow.

create function public.swamp_compile_filter(
  p_node   jsonb,
  p_fields jsonb,          -- { key: type }
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

  -- ── Group ──
  if p_node ? 'children' then
    if v_op not in ('and', 'or', 'not') then
      raise exception 'swamp: bad group operator %', v_op;
    end if;

    for v_child in select * from jsonb_array_elements(p_node->'children')
    loop
      v_parts := v_parts || public.swamp_compile_filter(v_child, p_fields, p_depth + 1);
    end loop;

    if array_length(v_parts, 1) is null then
      return 'true';                       -- an empty group filters nothing
    end if;

    if v_op = 'not' then
      return format('(not (%s))', array_to_string(v_parts, ' and '));
    end if;
    return format('(%s)', array_to_string(v_parts, ' ' || v_op || ' '));
  end if;

  -- ── Leaf ──
  v_key := p_node->>'field';

  -- THE INJECTION BOUNDARY. A field the client invents is not in the map, so it
  -- never reaches the SQL. Everything downstream can then trust v_key.
  if v_key is null or not (p_fields ? v_key) then
    raise exception 'swamp: unknown field %', coalesce(v_key, '(null)');
  end if;

  v_type  := p_fields->>v_key;
  v_expr  := public.swamp_field_expr(v_key, v_type);
  v_value := p_node->'value';
  v_sub   := p_node->>'subOp';
  v_n     := nullif(p_node->>'n', '')::int;

  case v_op
    -- Emptiness. A missing key and an empty string are different things in JSONB
    -- and the same thing to a user.
    when 'empty' then
      return format('(%s is null or (r.data->>%L) = %L)', v_expr, v_key, '');
    when 'notempty' then
      return format('(%s is not null and (r.data->>%L) <> %L)', v_expr, v_key, '');

    when 'eq' then
      if public.swamp_is_temporal_type(v_type) and v_sub is not null then
        v_range := public.swamp_date_window(v_sub, v_n);
        if v_range is null then
          -- exactDate: compare the calendar day, not the instant.
          return format('(date_trunc(%L, %s) = date_trunc(%L, %s))',
                        'day', v_expr, 'day', public.swamp_literal(v_value, v_type));
        end if;
        return format('(%s >= %L and %s < %L)',
                      v_expr, lower(v_range), v_expr, upper(v_range));
      end if;
      return format('(%s = %s)', v_expr, public.swamp_literal(v_value, v_type));

    -- IS DISTINCT FROM, not <>. `null <> 'x'` is null, which is not true, so a
    -- plain <> silently drops every empty cell from a "not equal" filter — and
    -- users are quite sure a blank cell is not equal to "Done".
    when 'neq' then
      return format('(%s is distinct from %s)', v_expr, public.swamp_literal(v_value, v_type));

    when 'gt'  then return format('(%s > %s)',  v_expr, public.swamp_literal(v_value, v_type));
    when 'gte' then return format('(%s >= %s)', v_expr, public.swamp_literal(v_value, v_type));
    when 'lt'  then return format('(%s < %s)',  v_expr, public.swamp_literal(v_value, v_type));
    when 'lte' then return format('(%s <= %s)', v_expr, public.swamp_literal(v_value, v_type));

    when 'btw' then
      return format('(%s between %s and %s)',
                    v_expr,
                    public.swamp_literal(v_value->0, v_type),
                    public.swamp_literal(v_value->1, v_type));

    when 'iswithin' then
      v_range := public.swamp_date_window(v_sub, v_n);
      if v_range is null then
        raise exception 'swamp: isWithin needs a valid subOp, got %', coalesce(v_sub, '(null)');
      end if;
      return format('(%s >= %L and %s < %L)',
                    v_expr, lower(v_range), v_expr, upper(v_range));

    -- ILIKE: a user searching "acme" means "Acme".
    when 'like' then
      return format('(%s ilike %L)', v_expr, '%' || (v_value #>> '{}') || '%');
    when 'nlike' then
      return format('(%s is null or %s not ilike %L)',
                    v_expr, v_expr, '%' || (v_value #>> '{}') || '%');

    when 'anyof' then
      if v_type = 'multiSelect' then
        return format('(%s ?| %s)', v_expr, public.swamp_text_array(v_value));
      end if;
      return format('(%s = any(%s))', v_expr, public.swamp_text_array(v_value));

    when 'nanyof' then
      if v_type = 'multiSelect' then
        return format('(%s is null or not (%s ?| %s))',
                      v_expr, v_expr, public.swamp_text_array(v_value));
      end if;
      return format('(%s is null or not (%s = any(%s)))',
                    v_expr, v_expr, public.swamp_text_array(v_value));

    when 'allof' then
      return format('(%s ?& %s)', v_expr, public.swamp_text_array(v_value));
    when 'nallof' then
      return format('(%s is null or not (%s ?& %s))',
                    v_expr, v_expr, public.swamp_text_array(v_value));

    when 'checked'    then return format('(%s is true)', v_expr);
    when 'notchecked' then return format('(%s is not true)', v_expr);

    else
      raise exception 'swamp: unknown operator %', coalesce(v_op, '(null)');
  end case;
end
$$;


-- ─── The query ──────────────────────────────────────────────────────────────
--
-- spec = {
--   "filter": <node>,
--   "sort":   [{ "field": "fld_x", "dir": "asc" }],
--   "search": "acme",
--   "limit":  50,                          -- capped at 500
--   "cursor": { "keys": [...], "sortOrder": "1.5", "id": "…" }
-- }
--
-- → { "records": [ { id, data, sortOrder, createdAt, ... } ], "next": <cursor|null> }

create function public.swamp_query_records(
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable                    -- SECURITY INVOKER (default). RLS applies. Deliberate.
as $$
declare
  v_fields     jsonb;
  v_where      text;
  v_sort       jsonb;
  v_key        text;
  v_type       text;
  v_dir        text;
  v_expr       text;

  v_exprs      text[] := '{}';   -- sort key expressions, in precedence order
  v_dirs       text[] := '{}';
  v_types      text[] := '{}';

  v_order      text;
  v_orderparts text[] := '{}';
  v_keysel     text;

  v_search     text;
  v_searchers  text[] := '{}';

  v_cursor     jsonb;
  v_keyset     text;

  v_limit      int;
  v_sql        text;
  v_rows       jsonb;
  v_last       jsonb;
  i            int;
begin
  -- Field catalog. RLS applies to this SELECT, so a user who can't see the table
  -- gets no fields and the query dies here rather than leaking its shape.
  select jsonb_object_agg(f.key, f.type::text)
    into v_fields
    from public.fields f
   where f.table_id = p_table_id
     and f.deleted_at is null;

  if v_fields is null then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  v_where := format('r.table_id = %L::uuid and r.deleted_at is null', p_table_id);

  -- ── WHERE ──
  if p_spec ? 'filter' then
    v_where := v_where || ' and ' || public.swamp_compile_filter(p_spec->'filter', v_fields);
  end if;

  -- ── Search: ILIKE across every text-ish field ──
  v_search := nullif(trim(coalesce(p_spec->>'search', '')), '');
  if v_search is not null then
    for v_key, v_type in select key, value #>> '{}' from jsonb_each(v_fields)
    loop
      if not public.swamp_is_numeric_type(v_type)
         and not public.swamp_is_temporal_type(v_type)
         and v_type not in ('boolean', 'multiSelect')
      then
        v_searchers := v_searchers
          || format('((r.data->>%L) ilike %L)', v_key, '%' || v_search || '%');
      end if;
    end loop;

    v_where := v_where || ' and ' ||
      coalesce('(' || array_to_string(v_searchers, ' or ') || ')', 'false');
  end if;

  -- ── ORDER BY ──
  for v_sort in select * from jsonb_array_elements(coalesce(p_spec->'sort', '[]'::jsonb))
  loop
    v_key := v_sort->>'field';
    if v_key is null or not (v_fields ? v_key) then
      raise exception 'swamp: cannot sort by unknown field %', coalesce(v_key, '(null)');
    end if;

    v_type := v_fields->>v_key;
    v_dir  := case lower(coalesce(v_sort->>'dir', 'asc')) when 'desc' then 'desc' else 'asc' end;
    v_expr := public.swamp_field_expr(v_key, v_type);

    v_exprs := v_exprs || v_expr;
    v_dirs  := v_dirs  || v_dir;
    v_types := v_types || v_type;

    -- NULLS LAST in BOTH directions. Postgres defaults to nulls-first on DESC,
    -- which floats every blank cell to the top of a Z→A sort and looks broken.
    v_orderparts := v_orderparts || format('%s %s nulls last', v_expr, v_dir);
  end loop;

  -- The tiebreaker is NOT optional.
  --
  -- Without a total order, two rows that compare equal under the user's sort can
  -- swap places between one page and the next. The reader sees row X twice and
  -- never sees row Y at all. It looks like data loss, it only happens under
  -- concurrent writes, and it is essentially impossible to reproduce on demand.
  v_orderparts := v_orderparts || 'r.sort_order asc' || 'r.id asc';
  v_order := array_to_string(v_orderparts, ', ');

  -- ── Keyset cursor ──
  --
  -- OFFSET is wrong on a table someone is writing to: insert one row above the
  -- window and every later page shifts by one. Keyset anchors on the last row you
  -- actually saw, so concurrent writes cannot smear the window.
  --
  -- With a user sort, the anchor must be the WHOLE ordering tuple, not just the
  -- tiebreaker — hence the OR-chain below:
  --
  --     k1 after v1
  --  OR (k1 = v1 AND k2 after v2)
  --  OR (k1 = v1 AND k2 = v2 AND (sort_order, id) > (so, id))
  --
  -- "after", under NULLS LAST:
  --     asc  → (k > v) OR (k IS NULL)      -- nulls sort last, so null is "after"
  --     desc → (k < v) OR (k IS NULL)
  --   and if v itself is null, nothing is after it by that key — fall to equality.
  v_cursor := p_spec->'cursor';
  if v_cursor is not null and jsonb_typeof(v_cursor) = 'object' and v_cursor ? 'id' then
    declare
      v_chain  text[] := '{}';
      v_eqs    text[] := '{}';
      v_cv     jsonb;
      v_after  text;
      v_lit    text;
    begin
      for i in 1 .. coalesce(array_length(v_exprs, 1), 0) loop
        v_cv  := (v_cursor->'keys')->(i - 1);
        v_lit := public.swamp_literal(v_cv, v_types[i]);

        if v_cv is null or jsonb_typeof(v_cv) = 'null' then
          -- The anchor row was null here. Nulls are last, so no row is strictly
          -- after it by this key. Only equality can carry us forward.
          v_after := 'false';
          v_eqs := v_eqs || format('(%s is null)', v_exprs[i]);
        else
          v_after := format('(%s %s %s or %s is null)',
                            v_exprs[i],
                            case v_dirs[i] when 'desc' then '<' else '>' end,
                            v_lit,
                            v_exprs[i]);
          v_eqs := v_eqs || format('(%s is not distinct from %s)', v_exprs[i], v_lit);
        end if;

        v_chain := v_chain || format(
          '(%s)',
          array_to_string(
            (case when i = 1 then '{}'::text[] else v_eqs[1 : i - 1] end) || v_after,
            ' and '
          )
        );
      end loop;

      -- Final rung: every sort key equal, break by the tiebreaker.
      v_chain := v_chain || format(
        '(%s)',
        array_to_string(
          v_eqs || format('(r.sort_order, r.id) > (%L::numeric, %L::uuid)',
                          v_cursor->>'sortOrder', v_cursor->>'id'),
          ' and '
        )
      );

      v_keyset := '(' || array_to_string(v_chain, ' or ') || ')';
      v_where := v_where || ' and ' || v_keyset;
    end;
  end if;

  v_limit := least(greatest(coalesce((p_spec->>'limit')::int, 50), 1), 500);

  -- The next cursor needs the anchor row's sort-key values, so project them.
  v_keysel := coalesce(
    'jsonb_build_array(' || array_to_string(v_exprs, ', ') || ')',
    '''[]''::jsonb'
  );

  v_sql := format($q$
    select coalesce(jsonb_agg(x order by rn), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'id',        r.id,
                 'data',      r.data,
                 'sortOrder', r.sort_order,
                 'createdAt', r.created_at,
                 'updatedAt', r.updated_at,
                 'createdBy', r.created_by,
                 'updatedBy', r.updated_by,
                 'keys',      %s
               ) as x,
               row_number() over (order by %s) as rn
          from public.records r
         where %s
         order by %s
         limit %s
      ) s
  $q$, v_keysel, v_order, v_where, v_order, v_limit);

  execute v_sql into v_rows;

  -- A short page means there is nothing after it. Only a full page gets a cursor.
  if jsonb_array_length(v_rows) = v_limit then
    v_last := v_rows -> (v_limit - 1);
  else
    v_last := null;
  end if;

  return jsonb_build_object(
    'records', v_rows,
    'next', case
      when v_last is null then null
      else jsonb_build_object(
        'keys',      coalesce(v_last->'keys', '[]'::jsonb),
        'sortOrder', v_last->>'sortOrder',
        'id',        v_last->>'id'
      )
    end
  );
end
$$;


-- ─── Count ──────────────────────────────────────────────────────────────────
-- Same filter, no pagination. Separate because most callers want rows and only
-- some want a total, and the count is the expensive half.

create function public.swamp_count_records(
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb
)
returns bigint
language plpgsql stable
as $$
declare
  v_fields jsonb;
  v_where  text;
  v_count  bigint;
begin
  select jsonb_object_agg(f.key, f.type::text)
    into v_fields
    from public.fields f
   where f.table_id = p_table_id
     and f.deleted_at is null;

  if v_fields is null then
    raise exception 'swamp: table % not found, or you cannot read it', p_table_id;
  end if;

  v_where := format('r.table_id = %L::uuid and r.deleted_at is null', p_table_id);

  if p_spec ? 'filter' then
    v_where := v_where || ' and ' || public.swamp_compile_filter(p_spec->'filter', v_fields);
  end if;

  execute format('select count(*) from public.records r where %s', v_where) into v_count;
  return v_count;
end
$$;


grant all on all routines in schema public to anon, authenticated, service_role;
