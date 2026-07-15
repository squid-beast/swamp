-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2 — the relational core.
--
--   link    → edges in `links`
--   count   → how many things this record links to
--   lookup  → pull a field across a link
--   rollup  → aggregate a field across a link
--   formula → an expression over this record's fields
--
-- ── The one idea ──
--
-- All five compile into the SELECT as SQL EXPRESSIONS. Not resolved in JavaScript
-- after the fact — compiled, alongside the scalar columns, in the same statement.
--
-- That single decision is what makes them filterable, sortable, searchable and
-- aggregatable *for free*. "Show me accounts whose total contract value > 50k,
-- sorted by it" is not a feature anyone has to build: it's the existing filter
-- and sort compiler pointed at an expression that happens to be a subquery.
--
-- Resolve them in the app instead and every one of those becomes a separate,
-- worse implementation — you'd fetch a page, compute rollups for it, and then
-- discover you can't filter on the result because the rows you needed weren't on
-- the page you fetched.
--
-- ── The field catalog ──
--
-- swamp_field_catalog() now returns, per field key, the SQL expression that
-- yields its value. Everything downstream — filters, sorts, search, projection —
-- just looks the expression up. A rollup and a text column are the same shape to
-- every consumer, which is exactly the point.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Formula AST → SQL ──────────────────────────────────────────────────────
--
-- The AST is parsed in TypeScript and stored as JSON on the field. Postgres
-- compiles it. The client never sends SQL, and it never sends a formula string
-- to be interpolated — it sends a tree of typed nodes.
--
-- Node shapes:
--   { "t": "num",   "v": 1 }
--   { "t": "str",   "v": "x" }
--   { "t": "bool",  "v": true }
--   { "t": "field", "id": "<field uuid>" }
--   { "t": "un",    "op": "-", "a": <node> }
--   { "t": "bin",   "op": "+", "l": <node>, "r": <node> }
--   { "t": "call",  "fn": "IF", "args": [<node>, ...] }
--
-- Field references are by ID, never by name. That is the whole reason a field has
-- both a `name` and a `key`: renaming "Amt" to "Contract value" must not break a
-- single formula, and it doesn't, because the formula never knew the name.

create function public.swamp_compile_formula(
  p_node    jsonb,
  p_catalog jsonb,     -- { key: { id, type, expr } }
  p_byid    jsonb,     -- { fieldId: key }
  p_depth   int default 0
)
returns text
language plpgsql stable
as $$
declare
  v_t     text;
  v_op    text;
  v_fn    text;
  v_key   text;
  v_args  text[] := '{}';
  v_arg   jsonb;
  v_l     text;
  v_r     text;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then
    return 'null';
  end if;

  -- A formula referencing a formula referencing a formula… A cycle would recurse
  -- forever; a cap turns it into an error the user can see.
  if p_depth > 20 then
    raise exception 'swamp: formula nested too deep (circular reference?)';
  end if;

  v_t := p_node->>'t';

  case v_t
    when 'num' then
      return format('%L::numeric', p_node->>'v');

    when 'str' then
      return quote_literal(p_node->>'v');

    when 'bool' then
      return case when (p_node->>'v')::boolean then 'true' else 'false' end;

    when 'field' then
      -- THE INJECTION BOUNDARY, again. A field id the client invents is not in
      -- the catalog, so it cannot reach the SQL.
      v_key := p_byid->>(p_node->>'id');
      if v_key is null or not (p_catalog ? v_key) then
        raise exception 'swamp: formula references a field that does not exist';
      end if;
      return '(' || (p_catalog->v_key->>'expr') || ')';

    when 'un' then
      v_op := p_node->>'op';
      if v_op not in ('-', '+', 'not') then
        raise exception 'swamp: bad unary operator %', v_op;
      end if;
      if v_op = 'not' then
        return format('(not %s)', public.swamp_compile_formula(p_node->'a', p_catalog, p_byid, p_depth + 1));
      end if;
      return format('(%s %s)', v_op,
                    public.swamp_compile_formula(p_node->'a', p_catalog, p_byid, p_depth + 1));

    when 'bin' then
      v_op := p_node->>'op';
      v_l := public.swamp_compile_formula(p_node->'l', p_catalog, p_byid, p_depth + 1);
      v_r := public.swamp_compile_formula(p_node->'r', p_catalog, p_byid, p_depth + 1);

      case v_op
        -- Arithmetic. Both sides coerced to numeric, safely: a text cell holding
        -- "N/A" becomes NULL rather than throwing and taking the query with it.
        when '+' then return format('(public.swamp_num(%s) + public.swamp_num(%s))', v_l, v_r);
        when '-' then return format('(public.swamp_num(%s) - public.swamp_num(%s))', v_l, v_r);
        when '*' then return format('(public.swamp_num(%s) * public.swamp_num(%s))', v_l, v_r);
        when '/' then
          -- nullif(x, 0): divide by zero yields NULL, not an exception. One bad
          -- row must not fail the page for every other row.
          return format('(public.swamp_num(%s) / nullif(public.swamp_num(%s), 0))', v_l, v_r);

        when '&' then return format('(coalesce(%s::text, '''') || coalesce(%s::text, ''''))', v_l, v_r);

        when '=' then return format('(%s::text is not distinct from %s::text)', v_l, v_r);
        when '!=' then return format('(%s::text is distinct from %s::text)', v_l, v_r);

        when '>'  then return format('(public.swamp_num(%s) >  public.swamp_num(%s))', v_l, v_r);
        when '>=' then return format('(public.swamp_num(%s) >= public.swamp_num(%s))', v_l, v_r);
        when '<'  then return format('(public.swamp_num(%s) <  public.swamp_num(%s))', v_l, v_r);
        when '<=' then return format('(public.swamp_num(%s) <= public.swamp_num(%s))', v_l, v_r);

        when 'and' then return format('(coalesce(%s::boolean, false) and coalesce(%s::boolean, false))', v_l, v_r);
        when 'or'  then return format('(coalesce(%s::boolean, false) or coalesce(%s::boolean, false))', v_l, v_r);

        else raise exception 'swamp: bad binary operator %', v_op;
      end case;

    when 'call' then
      v_fn := upper(p_node->>'fn');

      for v_arg in select * from jsonb_array_elements(coalesce(p_node->'args', '[]'::jsonb))
      loop
        v_args := v_args || public.swamp_compile_formula(v_arg, p_catalog, p_byid, p_depth + 1);
      end loop;

      return public.swamp_formula_fn(v_fn, v_args);

    else
      raise exception 'swamp: unknown formula node type %', coalesce(v_t, '(null)');
  end case;
end
$$;


/** Coerce anything to numeric, safely. NULL rather than an exception. */
create function public.swamp_num(t anyelement)
returns numeric
language plpgsql immutable parallel safe
as $$
begin
  return t::text::numeric;
exception when others then
  return null;
end
$$;


/**
 * The function library.
 *
 * A closed set, matched by name against a whitelist. Nothing here interpolates a
 * caller-supplied identifier — args are already-compiled SQL fragments, and the
 * function NAME is checked against this list before it can reach the output.
 */
create function public.swamp_formula_fn(p_fn text, p_args text[])
returns text
language plpgsql immutable
as $$
declare
  n int := coalesce(array_length(p_args, 1), 0);
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

    -- ── Dates ──
    when 'NOW'   then return 'now()';
    when 'TODAY' then return 'date_trunc(''day'', now())';
    when 'YEAR'  then return format('extract(year  from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'MONTH' then return format('extract(month from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'DAY'   then return format('extract(day   from public.swamp_to_timestamptz(%s::text))', p_args[1]);
    when 'WEEKDAY' then return format('extract(dow from public.swamp_to_timestamptz(%s::text))', p_args[1]);

    when 'DATEADD' then
      -- DATEADD(date, n, 'days')
      return format(
        '(public.swamp_to_timestamptz(%s::text) + make_interval(days => public.swamp_num(%s)::int))',
        p_args[1], p_args[2]);

    when 'DATEDIFF' then
      return format(
        'extract(day from (public.swamp_to_timestamptz(%s::text) - public.swamp_to_timestamptz(%s::text)))',
        p_args[1], p_args[2]);

    when 'DATEFORMAT' then
      return format('to_char(public.swamp_to_timestamptz(%s::text), %s::text)', p_args[1], p_args[2]);

    -- ── Record ──
    when 'RECORD_ID' then return 'r.id::text';

    else
      raise exception 'swamp: unknown function %', coalesce(p_fn, '(null)');
  end case;
end
$$;


-- ─── The field catalog ──────────────────────────────────────────────────────
--
-- Returns, per key: { id, type, expr }.
--
-- `expr` is the SQL that yields the field's value for the row aliased `r`. For a
-- text column that's `r.data->>'fld_x'`. For a rollup it's a correlated subquery.
-- Everything downstream treats them identically, which is the entire trick.
--
-- Built in PASSES, because a formula can reference a rollup, which references a
-- link. Pass 1 does everything that depends on nothing; later passes do formulas
-- whose referenced fields are already resolved. Anything still unresolved after
-- the last pass is a cycle, and it gets an error expression rather than hanging.

create or replace function public.swamp_field_catalog(p_table_id uuid)
returns jsonb
language plpgsql stable
as $$
declare
  v_cat     jsonb := '{}'::jsonb;
  v_byid    jsonb := '{}'::jsonb;
  v_f       record;
  v_expr    text;
  v_pass    int;
  v_pending boolean;

  v_link_id     uuid;
  v_target_key  text;
  v_target_type text;
  v_primary_key text;
  v_fn          text;
begin
  -- id → key, so formulas (which reference fields by id) can find them.
  select coalesce(jsonb_object_agg(f.id::text, f.key), '{}'::jsonb)
    into v_byid
    from public.fields f
   where f.table_id = p_table_id and f.deleted_at is null;

  -- ── Pass 1: everything that doesn't depend on another field of this table ──
  for v_f in
    select f.id, f.key, f.type::text as type, f.options
      from public.fields f
     where f.table_id = p_table_id
       and f.deleted_at is null
       and f.type <> 'formula'
     order by f.sort_order
  loop
    case v_f.type
      -- ── link: the linked records, as [{id, label}] ──
      when 'link' then
        -- The label is the TARGET table's primary field: what a record calls
        -- itself when something else refers to it.
        select tf.key into v_primary_key
          from public.fields tf
         where tf.table_id = (v_f.options->>'targetTableId')::uuid
           and tf.is_primary
           and tf.deleted_at is null
         limit 1;

        v_expr := format($e$(
          select coalesce(jsonb_agg(
                   jsonb_build_object('id', t.id, 'label', t.data->>%L)
                   order by l.sort_order
                 ), '[]'::jsonb)
            from public.links l
            join public.records t on t.id = l.to_record_id and t.deleted_at is null
           where l.field_id = %L::uuid and l.from_record_id = r.id
        )$e$, coalesce(v_primary_key, 'id'), v_f.id);

      -- ── count: how many ──
      when 'count' then
        v_link_id := (v_f.options->>'linkFieldId')::uuid;
        v_expr := format($e$(
          select count(*)::numeric
            from public.links l
            join public.records t on t.id = l.to_record_id and t.deleted_at is null
           where l.field_id = %L::uuid and l.from_record_id = r.id
        )$e$, v_link_id);

      -- ── lookup: pull a field across the link. Returns an ARRAY, because a
      --    many-link has many values and collapsing that to one would be a lie.
      when 'lookup' then
        v_link_id := (v_f.options->>'linkFieldId')::uuid;

        select tf.key, tf.type::text into v_target_key, v_target_type
          from public.fields tf
         where tf.id = (v_f.options->>'targetFieldId')::uuid
           and tf.deleted_at is null;

        if v_target_key is null then
          v_expr := 'null';   -- the target field was deleted: render blank, don't fail
        else
          v_expr := format($e$(
            select coalesce(jsonb_agg(t.data->%L order by l.sort_order)
                            filter (where t.data->%L is not null), '[]'::jsonb)
              from public.links l
              join public.records t on t.id = l.to_record_id and t.deleted_at is null
             where l.field_id = %L::uuid and l.from_record_id = r.id
          )$e$, v_target_key, v_target_key, v_link_id);
        end if;

      -- ── rollup: aggregate across the link ──
      when 'rollup' then
        v_link_id := (v_f.options->>'linkFieldId')::uuid;
        v_fn := lower(coalesce(v_f.options->>'fn', 'sum'));

        if v_fn not in ('count', 'sum', 'avg', 'min', 'max') then
          raise exception 'swamp: unknown rollup function %', v_fn;
        end if;

        select tf.key into v_target_key
          from public.fields tf
         where tf.id = (v_f.options->>'targetFieldId')::uuid
           and tf.deleted_at is null;

        if v_target_key is null and v_fn <> 'count' then
          v_expr := 'null';
        elsif v_fn = 'count' then
          v_expr := format($e$(
            select count(*)::numeric
              from public.links l
              join public.records t on t.id = l.to_record_id and t.deleted_at is null
             where l.field_id = %L::uuid and l.from_record_id = r.id
          )$e$, v_link_id);
        else
          v_expr := format($e$(
            select %s(public.swamp_to_numeric(t.data->>%L))
              from public.links l
              join public.records t on t.id = l.to_record_id and t.deleted_at is null
             where l.field_id = %L::uuid and l.from_record_id = r.id
          )$e$, v_fn, v_target_key, v_link_id);
        end if;

      -- ── auto-maintained ──
      when 'createdTime'  then v_expr := 'r.created_at';
      when 'modifiedTime' then v_expr := 'r.updated_at';
      when 'createdBy'    then v_expr := 'r.created_by::text';
      when 'modifiedBy'   then v_expr := 'r.updated_by::text';

      -- ── plain scalars ──
      else
        v_expr := public.swamp_field_expr(v_f.key, v_f.type);
    end case;

    v_cat := v_cat || jsonb_build_object(
      v_f.key, jsonb_build_object('id', v_f.id, 'type', v_f.type, 'expr', v_expr)
    );
  end loop;

  -- ── Passes 2..6: formulas ──
  --
  -- A formula may reference a rollup (pass 1) or another formula (an earlier
  -- pass). Repeat until nothing new resolves. Whatever is left is a cycle.
  for v_pass in 1..5 loop
    v_pending := false;

    for v_f in
      select f.id, f.key, f.type::text as type, f.options
        from public.fields f
       where f.table_id = p_table_id
         and f.deleted_at is null
         and f.type = 'formula'
       order by f.sort_order
    loop
      continue when v_cat ? v_f.key;

      begin
        v_expr := public.swamp_compile_formula(v_f.options->'ast', v_cat, v_byid);

        v_cat := v_cat || jsonb_build_object(
          v_f.key, jsonb_build_object('id', v_f.id, 'type', 'formula', 'expr', v_expr)
        );
      exception when others then
        -- Not resolvable YET (it references a formula we haven't compiled), or
        -- genuinely broken. Either way, try again next pass.
        v_pending := true;
      end;
    end loop;

    exit when not v_pending;
  end loop;

  -- Anything still missing is broken or circular. It gets a NULL expression
  -- rather than failing the query — a single bad formula must not make the whole
  -- table unreadable.
  for v_f in
    select f.id, f.key
      from public.fields f
     where f.table_id = p_table_id
       and f.deleted_at is null
       and f.type = 'formula'
  loop
    if not (v_cat ? v_f.key) then
      v_cat := v_cat || jsonb_build_object(
        v_f.key,
        jsonb_build_object('id', v_f.id, 'type', 'formula', 'expr', 'null', 'error', true)
      );
    end if;
  end loop;

  return v_cat;
end
$$;


-- ─── The query, rebuilt on the catalog ──────────────────────────────────────
--
-- Same contract as before. The only change: the field map is now {key: {type,
-- expr}} instead of {key: type}, and computed fields are merged into `data` on
-- the way out — so the client can't tell a rollup from a column, which is exactly
-- what we want.

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


create or replace function public.swamp_query_records(
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_fields     jsonb;
  v_where      text;
  v_sort       jsonb;
  v_key        text;
  v_type       text;
  v_dir        text;
  v_expr       text;

  v_exprs      text[] := '{}';
  v_dirs       text[] := '{}';
  v_types      text[] := '{}';

  v_order      text;
  v_orderparts text[] := '{}';
  v_keysel     text;

  v_search     text;
  v_searchers  text[] := '{}';

  v_computed   text[] := '{}';
  v_compsel    text;

  v_cursor     jsonb;
  v_limit      int;
  v_sql        text;
  v_rows       jsonb;
  v_last       jsonb;
  i            int;
begin
  v_fields := public.swamp_field_catalog(p_table_id);

  if v_fields is null or v_fields = '{}'::jsonb then
    raise exception 'swamp: table % not found, has no fields, or you cannot read it', p_table_id;
  end if;

  v_where := format('r.table_id = %L::uuid and r.deleted_at is null', p_table_id);

  if p_spec ? 'filter' then
    v_where := v_where || ' and ' || public.swamp_compile_filter(p_spec->'filter', v_fields);
  end if;

  -- Search across text-ish fields. Computed fields are searchable too — a lookup
  -- of a company name should be findable by typing the company name.
  v_search := nullif(trim(coalesce(p_spec->>'search', '')), '');
  if v_search is not null then
    for v_key, v_type in select key, value->>'type' from jsonb_each(v_fields)
    loop
      if not public.swamp_is_numeric_type(v_type)
         and not public.swamp_is_temporal_type(v_type)
         and v_type not in ('boolean', 'rollup', 'count')
      then
        v_searchers := v_searchers || format(
          '((%s)::text ilike %L)', v_fields->v_key->>'expr', '%' || v_search || '%'
        );
      end if;
    end loop;

    v_where := v_where || ' and ' ||
      coalesce('(' || array_to_string(v_searchers, ' or ') || ')', 'false');
  end if;

  -- ORDER BY. A rollup sorts exactly like a number, because by the time we get
  -- here it IS one — an expression that yields a numeric. Nothing special needed.
  for v_sort in select * from jsonb_array_elements(coalesce(p_spec->'sort', '[]'::jsonb))
  loop
    v_key := v_sort->>'field';
    if v_key is null or not (v_fields ? v_key) then
      raise exception 'swamp: cannot sort by unknown field %', coalesce(v_key, '(null)');
    end if;

    v_type := v_fields->v_key->>'type';
    v_dir  := case lower(coalesce(v_sort->>'dir', 'asc')) when 'desc' then 'desc' else 'asc' end;
    v_expr := '(' || (v_fields->v_key->>'expr') || ')';

    v_exprs := v_exprs || v_expr;
    v_dirs  := v_dirs  || v_dir;
    v_types := v_types || v_type;

    v_orderparts := v_orderparts || format('%s %s nulls last', v_expr, v_dir);
  end loop;

  v_orderparts := v_orderparts || 'r.sort_order asc' || 'r.id asc';
  v_order := array_to_string(v_orderparts, ', ');

  -- Keyset cursor, unchanged. See the 1b migration for why the OR-chain.
  v_cursor := p_spec->'cursor';
  if v_cursor is not null and jsonb_typeof(v_cursor) = 'object' and v_cursor ? 'id' then
    declare
      v_chain text[] := '{}';
      v_eqs   text[] := '{}';
      v_cv    jsonb;
      v_after text;
      v_lit   text;
    begin
      for i in 1 .. coalesce(array_length(v_exprs, 1), 0) loop
        v_cv  := (v_cursor->'keys')->(i - 1);
        v_lit := public.swamp_literal(v_cv, v_types[i]);

        if v_cv is null or jsonb_typeof(v_cv) = 'null' then
          v_after := 'false';
          v_eqs := v_eqs || format('(%s is null)', v_exprs[i]);
        else
          v_after := format('(%s %s %s or %s is null)', v_exprs[i],
                            case v_dirs[i] when 'desc' then '<' else '>' end,
                            v_lit, v_exprs[i]);
          v_eqs := v_eqs || format('(%s is not distinct from %s)', v_exprs[i], v_lit);
        end if;

        v_chain := v_chain || format('(%s)', array_to_string(
          (case when i = 1 then '{}'::text[] else v_eqs[1 : i - 1] end) || v_after, ' and '));
      end loop;

      v_chain := v_chain || format('(%s)', array_to_string(
        v_eqs || format('(r.sort_order, r.id) > (%L::numeric, %L::uuid)',
                        v_cursor->>'sortOrder', v_cursor->>'id'), ' and '));

      v_where := v_where || ' and (' || array_to_string(v_chain, ' or ') || ')';
    end;
  end if;

  v_limit := least(greatest(coalesce((p_spec->>'limit')::int, 50), 1), 500);

  -- Computed fields get merged INTO `data` on the way out.
  --
  -- The client can't tell a rollup from a stored column, and shouldn't have to:
  -- the grid renders `record.data[field.key]` whatever the field is. Keeping them
  -- in a separate bag would mean every consumer knowing which is which.
  for v_key, v_type in select key, value->>'type' from jsonb_each(v_fields)
  loop
    if v_type in ('link', 'lookup', 'rollup', 'count', 'formula',
                  'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy')
    then
      v_computed := v_computed || format(
        '%L, to_jsonb(%s)', v_key, v_fields->v_key->>'expr'
      );
    end if;
  end loop;

  v_compsel := case
    when array_length(v_computed, 1) is null then 'r.data'
    else format('(r.data || jsonb_build_object(%s))', array_to_string(v_computed, ', '))
  end;

  v_keysel := coalesce(
    'jsonb_build_array(' || array_to_string(v_exprs, ', ') || ')',
    '''[]''::jsonb'
  );

  v_sql := format($q$
    select coalesce(jsonb_agg(x order by rn), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'id',        r.id,
                 'data',      %s,
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
  $q$, v_compsel, v_keysel, v_order, v_where, v_order, v_limit);

  execute v_sql into v_rows;

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


create or replace function public.swamp_count_records(
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
  v_fields := public.swamp_field_catalog(p_table_id);

  if v_fields is null or v_fields = '{}'::jsonb then
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
