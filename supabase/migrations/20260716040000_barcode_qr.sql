-- Barcode and QR fields.
--
-- The last two of the seven types that were in FIELD_TYPES and the SQL enum from
-- the start and had no way to make one. These two are different from the other
-- five: they hold no value of their own. A barcode field POINTS at another field
-- and renders that field's value as a barcode.
--
-- swamp's schema already assumed exactly this design and only ever half-built it:
-- barcode/qr are in READ_ONLY (types.ts), excluded from swamp_writable_keys
-- (platform.sql:562), from the platform readOnly list (:417) and from
-- swamp_submit_form (sharing.sql). The database has always refused to store a value
-- for them. Nothing was ever producing one, so the cell was permanently blank —
-- which is why they rendered as plain text and looked merely ugly rather than
-- broken.
--
-- ── The one interesting decision ──
--
-- The projection in swamp_query_records decides, per field, whether a value comes
-- from `r.data->key` or from a computed `expr`. Its in-list
-- (platform.sql:1611-1612) does not mention barcode/qr, so they would fall to
-- `r.data->key` and be null forever. The obvious fix is to add them to that list —
-- which means replacing a 217-line function that is the hottest thing in the
-- product, to change two strings.
--
-- Instead these register in the CATALOG as `type: 'formula'`. The existing in-list
-- then merges them for free and swamp_query_records is untouched. This is not a
-- trick invented here: a URL button already does it, and platform.sql:1465 says so
-- out loud — "a URL button registers in the catalog AS a formula, so the existing
-- `v_type in (… 'formula' …)` already merges its value into `data`".
--
-- Everything below is verbatim from 20260714100000_fixes.sql except: the
-- `when 'barcode', 'qr'` arm, the v_cat_type variable it sets, and the
-- registration using v_cat_type instead of v_f.type. Extracted and patched
-- programmatically rather than retyped, because 186 lines of hand-copied plpgsql is
-- a transcription bug waiting to happen.

create or replace function public.swamp_field_catalog(
  p_table_id uuid,
  p_only     text[] default null
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
  v_cat_type    text;
  v_primary_key text;
  v_fn          text;
begin
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
       -- A URL button is deferred to the formula passes below: it may reference
       -- other fields, including other formulas.
       and not (f.type = 'button' and f.options ? 'ast')
       and (p_only is null or f.key = any(p_only))
     order by f.sort_order
  loop
    v_cat_type := v_f.type;

    case v_f.type
      when 'link' then
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

      when 'count' then
        v_link_id := (v_f.options->>'linkFieldId')::uuid;
        v_expr := format($e$(
          select count(*)::numeric
            from public.links l
            join public.records t on t.id = l.to_record_id and t.deleted_at is null
           where l.field_id = %L::uuid and l.from_record_id = r.id
        )$e$, v_link_id);

      when 'lookup' then
        v_link_id := (v_f.options->>'linkFieldId')::uuid;

        select tf.key, tf.type::text into v_target_key, v_target_type
          from public.fields tf
         where tf.id = (v_f.options->>'targetFieldId')::uuid
           and tf.deleted_at is null;

        if v_target_key is null then
          v_expr := 'null::text';   -- typed: to_jsonb(null) can't resolve its polymorphic arg
        else
          v_expr := format($e$(
            select coalesce(jsonb_agg(t.data->%L order by l.sort_order)
                            filter (where t.data->%L is not null), '[]'::jsonb)
              from public.links l
              join public.records t on t.id = l.to_record_id and t.deleted_at is null
             where l.field_id = %L::uuid and l.from_record_id = r.id
          )$e$, v_target_key, v_target_key, v_link_id);
        end if;

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
          v_expr := 'null::text';   -- typed: to_jsonb(null) can't resolve its polymorphic arg
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

      when 'barcode', 'qr' then
        -- A POINTER, not a value.
        --
        -- Same shape as NocoDB, which stores fk_barcode_value_column_id /
        -- fk_qr_value_column_id and selects the source column's value under the
        -- barcode column's alias (db/BaseModelSqlv2/select-object.ts:244). swamp's
        -- schema already assumed this: barcode/qr are in READ_ONLY and excluded
        -- from swamp_writable_keys, so the database has always refused to store a
        -- value for them. There was simply nothing producing one.
        --
        -- Sources are restricted to scalars on purpose. This is PASS 1, and
        -- formulas are not resolved until passes 2-6 below — a barcode pointing at
        -- a formula would read an expr that does not exist yet. The field dialog
        -- offers scalars only; this is the matching half.
        v_target_key  := null;
        v_target_type := null;

        if v_f.options ? 'sourceFieldId' then
          select f2.key, f2.type::text
            into v_target_key, v_target_type
            from public.fields f2
           where f2.id = (v_f.options->>'sourceFieldId')::uuid
             and f2.table_id = p_table_id
             and f2.deleted_at is null
             and f2.type not in ('formula', 'button', 'barcode', 'qr',
                                 'link', 'lookup', 'rollup', 'count');
        end if;

        -- No source, a deleted source, or one that isn't allowed: the cell is
        -- empty rather than an error. A barcode with nothing to encode is a blank,
        -- not a failure — and options.error is the formula channel, so borrowing it
        -- would make a retyped formula carry a stale #ERROR.
        if v_target_key is null then
          v_expr := 'null::text';
        else
          v_expr := format('(%s)::text',
                           public.swamp_field_expr(v_target_key, v_target_type));
        end if;

        -- Register AS a formula, so swamp_query_records merges the value into
        -- `data` through its existing `v_type in (… 'formula' …)` branch and that
        -- 217-line function needs no edit at all. This is exactly the trick a URL
        -- button already uses (see the note at platform.sql:1465 and the button
        -- registration below).
        v_cat_type := 'formula';

      when 'createdTime'  then v_expr := 'r.created_at';
      when 'modifiedTime' then v_expr := 'r.updated_at';
      when 'createdBy'    then v_expr := 'r.created_by::text';
      when 'modifiedBy'   then v_expr := 'r.updated_by::text';

      else
        v_expr := public.swamp_field_expr(v_f.key, v_f.type);
    end case;

    v_cat := v_cat || jsonb_build_object(
      v_f.key, jsonb_build_object('id', v_f.id, 'type', v_cat_type, 'expr', v_expr)
    );
  end loop;

  -- ── Passes 2..6: formulas, and URL buttons ──
  for v_pass in 1..5 loop
    v_pending := false;

    for v_f in
      select f.id, f.key, f.type::text as type, f.options
        from public.fields f
       where f.table_id = p_table_id
         and f.deleted_at is null
         and (f.type = 'formula' or (f.type = 'button' and f.options ? 'ast'))
         and (p_only is null or f.key = any(p_only))
       order by f.sort_order
    loop
      continue when v_cat ? v_f.key;

      begin
        v_expr := public.swamp_compile_formula(v_f.options->'ast', v_cat, v_byid);

        -- Registered as a formula whatever the field's declared type. For the
        -- query engine, that is what it is.
        v_cat := v_cat || jsonb_build_object(
          v_f.key, jsonb_build_object('id', v_f.id, 'type', 'formula', 'expr', v_expr)
        );
      exception when others then
        v_pending := true;
      end;
    end loop;

    exit when not v_pending;
  end loop;

  -- Anything still unresolved is broken or circular. A NULL expression, not a
  -- failed query: one bad formula must not make the whole table unreadable.
  for v_f in
    select f.id, f.key
      from public.fields f
     where f.table_id = p_table_id
       and f.deleted_at is null
       and (f.type = 'formula' or (f.type = 'button' and f.options ? 'ast'))
       and (p_only is null or f.key = any(p_only))
  loop
    if not (v_cat ? v_f.key) then
      v_cat := v_cat || jsonb_build_object(
        v_f.key,
        jsonb_build_object('id', v_f.id, 'type', 'formula', 'expr', 'null::text', 'error', true)
      );
    end if;
  end loop;

  return v_cat;
end
$$;