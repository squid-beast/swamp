-- ════════════════════════════════════════════════════════════════════════════
-- Phase 6.1 — two fixes the first full integration run surfaced.
--
--   1. A broken or circular formula compiled to a bare `null`, and the output
--      wrapped it in to_jsonb(null) — which Postgres can't type ("could not
--      determine polymorphic type because input has type unknown"), so ONE bad
--      formula made the whole table unreadable. The catalog now emits `null::text`.
--
--   2. Hard-deleting a base cascade-deleted its records, and the audit trigger
--      tried to write a history row referencing the base being deleted in the same
--      statement — a foreign-key violation that aborted the delete. Hard deletes
--      are base/table teardown (user deletes are SOFT, via the UPDATE branch, and
--      stay audited), so the trigger no longer writes history for them.
--
-- Both are `create or replace`, so this migration is the forward-only way to carry
-- the fixes to a database that already has the Phase 6 platform migration applied.
-- The platform migration's own copies were corrected too, so a fresh `db reset`
-- lands in the same place.
-- ════════════════════════════════════════════════════════════════════════════


create or replace function public.swamp_audit_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_op      text;
begin
  if tg_op = 'INSERT' then
    insert into public.record_audit (base_id, table_id, record_id, actor_id, op, changes)
    values (new.base_id, new.table_id, new.id, public.swamp_actor(), 'create', new.data);
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- A hard DELETE only happens when a base or table is torn down and the row is
    -- cascade-deleted. Writing an audit row here inserts into record_audit with a
    -- base_id that is being deleted in the very same statement — a foreign-key
    -- violation that aborts the whole cascade, so you cannot delete a base at all.
    --
    -- And it isn't a loss: a user "deleting" a record is a SOFT delete (the UPDATE
    -- branch below, op = 'delete'), which is still recorded. The only thing we skip
    -- auditing is the teardown of a base that is itself disappearing — history of a
    -- base nobody can open again.
    return old;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_op := 'delete';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_op := 'restore';
  else
    v_op := 'update';
  end if;

  if v_op = 'update' then
    for v_key in
      select k from jsonb_object_keys(old.data) k
      union
      select k from jsonb_object_keys(new.data) k
    loop
      if (old.data->v_key) is distinct from (new.data->v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', old.data->v_key, 'to', new.data->v_key)
        );
      end if;
    end loop;

    if v_changes = '{}'::jsonb then
      return new;
    end if;
  else
    v_changes := '{}'::jsonb;
  end if;

  insert into public.record_audit (base_id, table_id, record_id, actor_id, op, changes)
  values (new.base_id, new.table_id, new.id, public.swamp_actor(), v_op, v_changes);

  return new;
end
$$;


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

      when 'createdTime'  then v_expr := 'r.created_at';
      when 'modifiedTime' then v_expr := 'r.updated_at';
      when 'createdBy'    then v_expr := 'r.created_by::text';
      when 'modifiedBy'   then v_expr := 'r.updated_by::text';

      else
        v_expr := public.swamp_field_expr(v_f.key, v_f.type);
    end case;

    v_cat := v_cat || jsonb_build_object(
      v_f.key, jsonb_build_object('id', v_f.id, 'type', v_f.type, 'expr', v_expr)
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
