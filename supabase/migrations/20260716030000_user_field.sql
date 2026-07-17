-- Keep `user` fields off public forms.
--
-- The `user` field type is now offered in the field dialog. It stores a uuid and
-- means "a person here is responsible", which makes it the one writable type that
-- must not be reachable by a stranger:
--
--   * The picker needs the base's roster, and the roster is deliberately private —
--     /api/bases/[id]/members requires auth, and swamp_visible_profiles is granted
--     to `authenticated` only. On a public form the control could only ever render
--     empty.
--   * Worse, `swamp_submit_form` builds its allow-list by EXCLUSION, so any type
--     not named in that NOT IN list is writable by anon. `user` was not named, so
--     an anonymous submitter could post an arbitrary uuid — including one that is
--     not a member of the base, or is a member and now appears to have volunteered
--     for something. That is unvalidated data from an untrusted source landing in a
--     column about people.
--
-- The client filter in form-runtime.tsx is not the boundary and never was; this is.
--
-- NocoDB does allow User on a form (its formViewHiddenColTypes at
-- packages/nc-gui/utils/columnUtils.ts:472-484 lists QrCode, Barcode, Button,
-- CreatedTime, LastModifiedTime, CreatedBy, LastModifiedBy — not User). This is a
-- considered difference: NocoDB's forms can reach a roster, swamp's public ones
-- deliberately cannot.
--
-- Everything else about this function is unchanged from 20260714070000_sharing.sql.
-- The only edit is 'user' in the NOT IN list.

create or replace function public.swamp_submit_form(
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

  -- The fields this form actually shows, minus anything computed, minus `user`.
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
                        'user',
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

-- No grants restated: CREATE OR REPLACE keeps the function's OID, and with it the
-- privileges granted in 20260714070000_sharing.sql. Verified rather than assumed —
-- anon still has EXECUTE after this runs, which the assert below pins down, because
-- a public form that 403s is exactly the kind of thing you find out about from a
-- user rather than from a test.
do $$
begin
  assert has_function_privilege(
           'anon', 'public.swamp_submit_form(text,text,jsonb)', 'execute'
         ),
         'anon lost EXECUTE on swamp_submit_form — public forms are broken';
end $$;
