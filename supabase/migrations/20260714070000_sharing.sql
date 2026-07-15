-- ════════════════════════════════════════════════════════════════════════════
-- Phase 4 — public shared views.
--
-- ── The problem ──
--
-- Every read in SWAMP is scoped by RLS to `auth.uid()`. An anonymous visitor with
-- a share link has no uid. There is nothing for RLS to scope to.
--
-- The tempting fix is a policy like `using (true)` on some path, or handing the
-- anon role a grant that lets it see records "when the view is shared". Both leak:
-- the first is obvious, the second less so — a policy that says "you may read a
-- record if SOME shared view of its table exists" lets a visitor with one share
-- link read rows that view filters out, and columns it hides.
--
-- ── The fix ──
--
-- A small set of SECURITY DEFINER functions that are the ONLY way anon can reach
-- a record. They:
--
--   1. Take the share_id as an argument and look the view up themselves. Anon
--      never names a table, a record, or a field — it names a share link, and the
--      function derives everything else.
--   2. Check the password before doing anything.
--   3. AND the view's own filter into the query. A visitor may add filters; they
--      cannot remove the one the view was shared with.
--   4. STRIP hidden fields from the result. A column hidden from a view must not
--      arrive in the payload — "hidden in the UI" is not hidden.
--
-- Anon gets EXECUTE on these functions and nothing else. It has no grant on
-- `records`, so there is no other door.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;


-- ─── Scoping the query engine to a set of fields ────────────────────────────
--
-- Stripping hidden fields from the RESULT is not enough, and this is the subtle
-- part of the whole feature.
--
-- The query engine's catalog knows every field on the table. So a visitor to a
-- shared view could send `filter: { field: "fld_salary", op: "gt", value: 100000 }`
-- — a column the view hides — and read the answer off the row count. They never
-- see the value, but they can binary-search it. Search has the same shape: an
-- ILIKE across every field tells you whether a hidden one contains a string.
--
-- A blind oracle is still a leak. So the engine takes an ALLOWLIST: when it's
-- given one, the catalog contains nothing else, and a filter or sort naming a
-- field outside it fails with "unknown field" — which is true, because as far as
-- that query is concerned, it doesn't exist.

drop function if exists public.swamp_field_catalog(uuid);
drop function if exists public.swamp_query_records(uuid, jsonb);
drop function if exists public.swamp_count_records(uuid, jsonb);


create or replace function public.swamp_field_catalog(
  p_table_id uuid,
  p_only     text[] default null   -- NULL = every field. Non-null = ONLY these.
)
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
   where f.table_id = p_table_id
     and f.deleted_at is null
     and (p_only is null or f.key = any(p_only));

  -- ── Pass 1: everything that doesn't depend on another field of this table ──
  for v_f in
    select f.id, f.key, f.type::text as type, f.options
      from public.fields f
     where f.table_id = p_table_id
       and f.deleted_at is null
       and f.type <> 'formula'
       and (p_only is null or f.key = any(p_only))
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
         and (p_only is null or f.key = any(p_only))
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
       and (p_only is null or f.key = any(p_only))
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

create or replace function public.swamp_query_records(
  p_table_id uuid,
  p_spec     jsonb  default '{}'::jsonb,
  p_only     text[] default null   -- restrict the catalog. See the note above.
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
  v_fields := public.swamp_field_catalog(p_table_id, p_only);

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

  execute format('select count(*) from public.records r where %s', v_where) into v_count;
  return v_count;
end
$$;


-- ─── Resolve a share link ───────────────────────────────────────────────────
--
-- Returns the view row, or raises. Every public function starts here, so the
-- password check exists in exactly one place.

create function public.swamp_resolve_share(
  p_share_id text,
  p_password text default null
)
returns public.views
language plpgsql
security definer
-- `extensions` is on the path because crypt() lives in pgcrypto, which hosted
-- Supabase installs into the `extensions` schema (the local CLI stack installs it
-- into `public`). A definer function pins its own search_path, so without naming
-- both, this resolves crypt() on your laptop and raises "function crypt does not
-- exist" the first time a password-protected share is opened in production.
set search_path = public, extensions, pg_temp
as $$
declare
  v_view public.views;
begin
  select * into v_view
    from public.views
   where share_id = p_share_id
     and deleted_at is null;

  if v_view.id is null then
    raise exception 'swamp: no such shared view';
  end if;

  -- A password-protected view. crypt() with the stored hash as the salt is the
  -- standard bcrypt compare — it re-derives the hash and compares in one step,
  -- and it's constant-time.
  if v_view.share_password_hash is not null then
    if p_password is null
       or crypt(p_password, v_view.share_password_hash) <> v_view.share_password_hash
    then
      raise exception 'swamp: password required' using errcode = '28000';
    end if;
  end if;

  return v_view;
end
$$;


-- ─── Share / unshare ────────────────────────────────────────────────────────
--
-- SECURITY INVOKER: sharing a view is a normal write to `views`, and RLS already
-- says who may do it (editor and up). No reason to bypass anything.
--
-- The hash is computed HERE rather than in TypeScript so the plaintext password
-- never travels further than this function call, and so there is one place that
-- decides what "hashed" means.

create function public.swamp_share_view(
  p_view_id  uuid,
  p_password text default null
)
returns text
language plpgsql
-- gen_random_bytes / gen_salt / crypt are pgcrypto — see the note on
-- swamp_resolve_share. Name `extensions` so this resolves on hosted Supabase too.
set search_path = public, extensions, pg_temp
as $$
declare
  v_share_id text;
begin
  -- 22 chars of base64ish entropy. Long enough that a share link is not
  -- enumerable, short enough to paste into a chat message.
  v_share_id := replace(replace(encode(gen_random_bytes(16), 'base64'), '/', '_'), '+', '-');
  v_share_id := rtrim(v_share_id, '=');

  update public.views
     set share_id = v_share_id,
         share_password_hash = case
           when p_password is null or p_password = '' then null
           else crypt(p_password, gen_salt('bf'))
         end
   where id = p_view_id
     and deleted_at is null;

  if not found then
    raise exception 'swamp: view not found, or you cannot share it';
  end if;

  return v_share_id;
end
$$;


create function public.swamp_unshare_view(p_view_id uuid)
returns void
language plpgsql
as $$
begin
  update public.views
     set share_id = null,
         share_password_hash = null
   where id = p_view_id;
end
$$;


-- ─── Public: the view's shape ───────────────────────────────────────────────
--
-- Fields the view HIDES are not returned at all. Not marked hidden — absent. A
-- visitor cannot ask for a column they were never told about, and cannot filter or
-- sort by one either, because the query engine only knows the fields it was given.

create function public.swamp_shared_meta(
  p_share_id text,
  p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_view   public.views;
  v_table  public.tables;
  v_fields jsonb;
begin
  v_view := public.swamp_resolve_share(p_share_id, p_password);

  select * into v_table from public.tables where id = v_view.table_id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', f.id, 'name', f.name, 'key', f.key,
             'type', f.type, 'options', f.options,
             'isPrimary', f.is_primary, 'sortOrder', f.sort_order,
             'formConfig', coalesce(vf.form_config, '{}'::jsonb)
           )
           order by coalesce(vf.sort_order, f.sort_order)
         ), '[]'::jsonb)
    into v_fields
    from public.fields f
    left join public.view_fields vf
      on vf.view_id = v_view.id and vf.field_id = f.id
   where f.table_id = v_view.table_id
     and f.deleted_at is null
     -- The default is SHOWN: a field with no view_fields row is visible. But an
     -- explicit `show = false` means the owner hid it, and hidden means gone.
     and coalesce(vf.show, true);

  return jsonb_build_object(
    'view', jsonb_build_object(
      'id', v_view.id, 'type', v_view.type, 'name', v_view.name,
      'config', v_view.config, 'shareOptions', v_view.share_options
    ),
    'table', jsonb_build_object('id', v_table.id, 'name', v_table.name),
    'fields', v_fields
  );
end
$$;


-- ─── Public: records ────────────────────────────────────────────────────────

create function public.swamp_shared_records(
  p_share_id text,
  p_password text default null,
  p_spec     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_view    public.views;
  v_filter  jsonb;
  v_spec    jsonb;
  v_visible text[];
begin
  v_view := public.swamp_resolve_share(p_share_id, p_password);

  -- The fields this view SHOWS. Everything downstream sees only these — the query
  -- engine's catalog is built from this list, so a hidden column is not merely
  -- absent from the payload, it is absent from the QUERY. A visitor cannot filter
  -- on it, sort by it, or search it, because as far as this query is concerned it
  -- does not exist.
  --
  -- Stripping hidden keys from the result would leave a blind oracle: filter by
  -- {salary} > 100000, read the answer off the row count, binary-search the value
  -- you were never shown. This closes that.
  select coalesce(array_agg(f.key), '{}'::text[])
    into v_visible
    from public.fields f
    left join public.view_fields vf
      on vf.view_id = v_view.id and vf.field_id = f.id
   where f.table_id = v_view.table_id
     and f.deleted_at is null
     -- Default is SHOWN: a field with no view_fields row is visible. An explicit
     -- `show = false` means the owner hid it, and hidden means gone.
     and coalesce(vf.show, true);

  -- The view's own filter, AND-ed with whatever the visitor asked for.
  --
  -- AND, not replace. A visitor may NARROW what they see; they may not widen it.
  -- Replacing the filter is the bug that turns "a shared view of public deals"
  -- into "a shared view of every deal".
  v_filter := public.swamp_view_filter_json(v_view.id);
  v_spec := coalesce(p_spec, '{}'::jsonb);

  if v_filter is not null then
    if v_spec ? 'filter' then
      v_spec := jsonb_set(v_spec, '{filter}', jsonb_build_object(
        'op', 'and',
        'children', jsonb_build_array(v_filter, v_spec->'filter')
      ));
    else
      v_spec := jsonb_set(v_spec, '{filter}', v_filter, true);
    end if;
  end if;

  -- The view's sorts, unless the visitor chose their own.
  if not (v_spec ? 'sort') then
    v_spec := jsonb_set(v_spec, '{sort}', public.swamp_view_sort_json(v_view.id), true);
  end if;

  return public.swamp_query_records(v_view.table_id, v_spec, v_visible);
end
$$;


/** A view's saved filter tree, as the JSON the compiler expects. */
create function public.swamp_view_filter_json(p_view_id uuid)
returns jsonb
language plpgsql stable
as $$
declare
  v_roots jsonb;
begin
  select coalesce(jsonb_agg(public.swamp_filter_node_json(f.id) order by f.sort_order), '[]'::jsonb)
    into v_roots
    from public.filters f
   where f.view_id = p_view_id
     and f.parent_id is null
     and f.enabled;

  if jsonb_array_length(v_roots) = 0 then return null; end if;
  if jsonb_array_length(v_roots) = 1 then return v_roots->0; end if;

  return jsonb_build_object('op', 'and', 'children', v_roots);
end
$$;


create function public.swamp_filter_node_json(p_id uuid)
returns jsonb
language plpgsql stable
as $$
declare
  v_row   public.filters;
  v_key   text;
  v_kids  jsonb;
begin
  select * into v_row from public.filters where id = p_id;
  if v_row.id is null then return null; end if;

  if v_row.is_group then
    select coalesce(jsonb_agg(public.swamp_filter_node_json(c.id) order by c.sort_order), '[]'::jsonb)
      into v_kids
      from public.filters c
     where c.parent_id = v_row.id and c.enabled;

    return jsonb_build_object('op', v_row.logical_op, 'children', v_kids);
  end if;

  select f.key into v_key from public.fields f where f.id = v_row.field_id;
  if v_key is null then return null; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'field', v_key,
    'op',    v_row.op,
    'value', v_row.value,
    'subOp', v_row.sub_op
  ));
end
$$;


create function public.swamp_view_sort_json(p_view_id uuid)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('field', f.key, 'dir', s.direction)
           order by s.sort_order
         ), '[]'::jsonb)
    from public.sorts s
    join public.fields f on f.id = s.field_id and f.deleted_at is null
   where s.view_id = p_view_id
$$;


-- ─── Public: form submission ────────────────────────────────────────────────
--
-- The one place an anonymous visitor may WRITE.
--
-- Constrained hard:
--   • Only a FORM view. Sharing a grid publicly must not make it writable.
--   • Only fields the form shows. A key the form doesn't display cannot be set,
--     no matter what the client posts — which is what stops someone POSTing
--     `{"fld_internal_score": 100}` at your contact form.
--   • Read-only field types are dropped regardless.

create function public.swamp_submit_form(
  p_share_id text,
  p_password text default null,
  p_values   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_view    public.views;
  v_allowed text[];
  v_data    jsonb := '{}'::jsonb;
  v_key     text;
  v_id      uuid;
  v_order   numeric;
begin
  v_view := public.swamp_resolve_share(p_share_id, p_password);

  if v_view.type <> 'form' then
    raise exception 'swamp: that shared view is not a form';
  end if;

  -- The fields this form actually shows, minus anything computed.
  select coalesce(array_agg(f.key), '{}'::text[])
    into v_allowed
    from public.fields f
    left join public.view_fields vf
      on vf.view_id = v_view.id and vf.field_id = f.id
   where f.table_id = v_view.table_id
     and f.deleted_at is null
     and coalesce(vf.show, true)
     and f.type not in ('link', 'lookup', 'rollup', 'formula', 'count',
                        'button', 'barcode', 'qr',
                        'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy');

  foreach v_key in array v_allowed loop
    if p_values ? v_key then
      v_data := v_data || jsonb_build_object(v_key, p_values->v_key);
    end if;
  end loop;

  select coalesce(max(sort_order), 0) + 1 into v_order
    from public.records
   where table_id = v_view.table_id and deleted_at is null;

  insert into public.records (table_id, base_id, data, sort_order)
  values (v_view.table_id, v_view.base_id, v_data, v_order)
  returning id into v_id;

  return v_id;
end
$$;


-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- anon gets EXECUTE on exactly these four, and nothing else. It has no grant that
-- lets it touch `records` directly, so these functions are the only door.

revoke all on function public.swamp_resolve_share(text, text) from anon;

grant execute on function public.swamp_shared_meta(text, text) to anon;
grant execute on function public.swamp_shared_records(text, text, jsonb) to anon;
grant execute on function public.swamp_submit_form(text, text, jsonb) to anon;

grant execute on function public.swamp_share_view(uuid, text) to authenticated;
grant execute on function public.swamp_unshare_view(uuid) to authenticated;
grant all on all routines in schema public to authenticated, service_role;
