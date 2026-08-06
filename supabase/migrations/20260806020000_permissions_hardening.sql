-- ════════════════════════════════════════════════════════════════════════════
-- Table & field permissions — hardening. Six defects found by attacking the
-- Stage-2 enforcement, four of them holes rather than blemishes.
--
-- 1. NULL IS NOT FALSE (critical). swamp_base_role_of returns NULL for a
--    non-member, so swamp_role_rank(NULL) is NULL, the resolver returned NULL,
--    and the caller's `if not (...)` never fired — a logged-in stranger writing
--    through a public form was ALLOWED by a rule that named a role. Same for a
--    NULL element in user_ids: `x = any(array[null])` is NULL, so "only these
--    people" permitted everyone. Every boolean the resolver returns is now
--    coalesced, and the trigger treats a NULL answer as denial too.
--
-- 2. base_id WAS CLIENT-CONTROLLED (critical). records.base_id is denormalised
--    and supplied by the caller. The trigger read `new.base_id` for both the
--    has_permissions fast path and the role lookup, so a writer could point it
--    at a base of their own with no rules and skip all three keys while the row
--    still landed in the victim's table_id. The authoritative base now comes
--    from public.tables, and a mismatched base_id is refused outright.
--
-- 3. A RULE COULD BE PLANTED CROSS-TENANT (high). Nothing tied
--    permissions.table_id to permissions.base_id, so anyone could insert a rule
--    carrying their OWN base_id and a VICTIM's table_id: RLS checked their base,
--    and the resolver looks rules up by table_id alone. That let a stranger lock
--    another tenant's field, and squat the unique-index slot so the real owner
--    could not write the rule back. Composite foreign keys now make the
--    combination unrepresentable.
--
-- 4. HARD DELETE BYPASSED table_record_delete (high). The trigger covered INSERT
--    and UPDATE; the records policy is `for all`, so an editor could issue a
--    real DELETE through PostgREST and destroy a row the rule protected. Now
--    covered — while still permitting the cascade from dropping a table or base,
--    which is not a record deletion.
--
-- 5. swamp_writable_keys IS REVERTED to its original definition. Teaching it
--    about field rules looked like a courtesy and was the opposite:
--    swamp_pick_writable DROPS unknown keys silently, so a locked field became a
--    silent no-op on the token path instead of an error. It also accidentally
--    added 'autoNumber' to the exclusion list, breaking upserts keyed on one.
--    The trigger raises; that is the honest answer.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 5. Revert swamp_writable_keys, verbatim to 20260714090000_platform.sql ──

create or replace function public.swamp_writable_keys(p_table_id uuid)
returns text[]
language sql stable
as $$
  select coalesce(array_agg(f.key), '{}'::text[])
    from public.fields f
   where f.table_id = p_table_id
     and f.deleted_at is null
     and f.type not in ('link', 'lookup', 'rollup', 'formula', 'count',
                        'button', 'barcode', 'qr',
                        'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy')
$$;

-- ─── 3. Make a cross-tenant rule unrepresentable ────────────────────────────

alter table public.tables add constraint tables_id_base_uniq unique (id, base_id);
alter table public.fields add constraint fields_id_table_uniq unique (id, table_id);

-- Clean out anything the window above could have admitted, then bolt the door.
delete from public.permissions p
 where not exists (
   select 1 from public.tables t where t.id = p.table_id and t.base_id = p.base_id
 );

alter table public.permissions
  add constraint permissions_table_in_base
    foreign key (table_id, base_id) references public.tables(id, base_id) on delete cascade,
  add constraint permissions_field_in_table
    foreign key (field_id, table_id) references public.fields(id, table_id) on delete cascade;

-- ─── 1. No NULL elements in user_ids ────────────────────────────────────────

alter table public.permissions
  add constraint permissions_user_ids_no_nulls
    check (user_ids is null or array_position(user_ids, null) is null);

-- ─── 1. The resolver: every path returns a real boolean ─────────────────────

create or replace function public.swamp_permission_allows(
  p_base_id  uuid,
  p_table_id uuid,
  p_key      text,
  p_field_id uuid,
  p_user_id  uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.permissions;
begin
  select * into v_rule
    from public.permissions
   where table_id = p_table_id
     and key = p_key
     and field_id is not distinct from p_field_id;

  -- No rule: the role ladder alone decides. The 99% case.
  if v_rule.id is null then
    return true;
  end if;

  if p_user_id is null then
    return false;
  end if;

  case v_rule.granted_type
    when 'nobody' then
      return false;

    when 'user' then
      -- coalesce: `x = any(array[...])` yields NULL if the array holds a NULL,
      -- and a NULL answer was read as "allow" by every caller.
      return coalesce(p_user_id = any(v_rule.user_ids), false);

    when 'role' then
      -- coalesce: swamp_base_role_of is NULL for a NON-MEMBER, and
      -- swamp_role_rank(NULL) is NULL — so this comparison returned NULL and a
      -- stranger was let through. A non-member outranks nobody.
      return coalesce(
        public.swamp_role_rank(public.swamp_base_role_of(p_base_id, p_user_id))
          >= public.swamp_role_rank(v_rule.role),
        false
      );

    else
      return false;
  end case;
end
$$;

-- ─── 2. Heal any pre-existing drift BEFORE the check starts biting ──────────
--
-- The trigger below refuses a write whose base_id disagrees with its table's.
-- That is right for new writes, but a row that ALREADY drifted would become
-- unwritable — every future edit to it would fail, in production, with no way
-- for the user to fix it from the UI. A record belongs to a table, so the
-- table's base is authoritative; correct the column once, here.
--
-- Expected to match zero rows: nothing in the app has ever written a base_id
-- that wasn't read off the table. It is insurance, and it is why the deploy is
-- safe rather than merely tested.
update public.records r
   set base_id = t.base_id
  from public.tables t
 where t.id = r.table_id
   and r.base_id is distinct from t.base_id;

-- ─── 2 + 4. The trigger: authoritative base, and deletes ────────────────────

create or replace function public.swamp_enforce_record_permissions()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row     record;      -- NEW on insert/update, OLD on delete
  v_base    uuid;
  v_flag    boolean;
  v_actor   uuid;
  v_field   record;
  v_key     text;
  v_ok      boolean;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- THE authoritative base for this row is the one its TABLE belongs to, never
  -- the denormalised base_id the caller supplied. Reading new.base_id let a
  -- writer aim the whole check at a base of their own that has no rules.
  select t.base_id into v_base
    from public.tables t where t.id = v_row.table_id;

  if v_base is null then
    -- The table is gone: this is the cascade from dropping a table or a base,
    -- not somebody deleting a record. Let it through, or a permission rule
    -- would make its own table undroppable.
    return v_row;
  end if;

  -- And refuse a spoofed base_id outright, so nothing downstream (webhooks,
  -- storage paths, audit rows) inherits the lie either.
  if tg_op <> 'DELETE' and new.base_id is distinct from v_base then
    raise exception 'swamp: base_id does not match the record''s table'
      using errcode = '23514';
  end if;

  select b.has_permissions into v_flag from public.bases b where b.id = v_base;
  if v_flag is not true then
    return v_row;
  end if;

  -- The system is not a person: the Sheets cron and the webhook dispatcher run
  -- with no identity and are gated by CRON_SECRET instead.
  if current_user = 'service_role' then
    return v_row;
  end if;

  v_actor := public.swamp_actor();

  -- ── Add / delete / restore ──
  if tg_op = 'INSERT' then
    v_ok := public.swamp_permission_allows(v_base, new.table_id, 'table_record_add', null, v_actor);
    if v_ok is not true then
      raise exception 'swamp: you may not add records to this table' using errcode = '42501';
    end if;

  elsif tg_op = 'DELETE' then
    -- A hard DELETE destroys the row outright; the app only soft-deletes, but
    -- PostgREST exposes the verb and the records policy is `for all`.
    v_ok := public.swamp_permission_allows(v_base, old.table_id, 'table_record_delete', null, v_actor);
    if v_ok is not true then
      raise exception 'swamp: you may not delete records in this table' using errcode = '42501';
    end if;
    return old;

  elsif tg_op = 'UPDATE' then
    -- Soft delete and its UNDO are the same door.
    if (old.deleted_at is null) <> (new.deleted_at is null) then
      v_ok := public.swamp_permission_allows(v_base, new.table_id, 'table_record_delete', null, v_actor);
      if v_ok is not true then
        raise exception 'swamp: you may not delete or restore records in this table'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- ── Field edits ──
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.data is distinct from old.data) then
    for v_field in
      select f.id, f.key, f.name
        from public.fields f
        join public.permissions p
          on p.field_id = f.id and p.key = 'record_field_edit'
       where f.table_id = new.table_id
         and f.deleted_at is null
    loop
      v_key := v_field.key;

      if tg_op = 'INSERT' then
        continue when not (new.data ? v_key);
      else
        continue when (old.data -> v_key) is not distinct from (new.data -> v_key);
      end if;

      v_ok := public.swamp_permission_allows(
        v_base, new.table_id, 'record_field_edit', v_field.id, v_actor);
      if v_ok is not true then
        raise exception 'swamp: you may not edit "%" on this table', v_field.name
          using errcode = '42501';
      end if;
    end loop;
  end if;

  return v_row;
end
$$;

drop trigger if exists records_permissions on public.records;

create trigger records_permissions
  before insert or update or delete on public.records
  for each row execute function public.swamp_enforce_record_permissions();

revoke all on function public.swamp_enforce_record_permissions() from public, anon;

-- ─── 6. Atomic rule replacement ─────────────────────────────────────────────
--
-- The management route replaced a rule with a DELETE then an INSERT, over two
-- separate HTTP round trips. The delete commits; if the insert then fails (the
-- field was retyped to a formula, someone raced the same switch, a constraint
-- caught it) the target is left with NO rule at all — silently unprotected,
-- which is the one direction a permission edit must never fail in.
--
-- One function, one transaction. SECURITY INVOKER: RLS on public.permissions
-- still decides who may write, exactly as before.

create or replace function public.swamp_set_permission(
  p_table_id     uuid,
  p_key          text,
  p_field_id     uuid,
  p_granted_type text,
  p_role         public.swamp_role,
  p_user_ids     uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_base uuid;
  v_id   uuid;
begin
  -- The base comes from the TABLE, never the caller. A rule carrying someone
  -- else's base_id is refused by the composite FK above anyway; this stops the
  -- caller from having to be trusted in the first place.
  select base_id into v_base from public.tables
   where id = p_table_id and deleted_at is null;

  if v_base is null then
    raise exception 'swamp: no such table' using errcode = '42P01';
  end if;

  delete from public.permissions
   where table_id = p_table_id
     and key = p_key
     and field_id is not distinct from p_field_id;

  insert into public.permissions
    (base_id, table_id, field_id, key, granted_type, role, user_ids)
  values
    (v_base, p_table_id, p_field_id, p_key, p_granted_type,
     case when p_granted_type = 'role' then p_role else null end,
     case when p_granted_type = 'user' then coalesce(p_user_ids, '{}') else '{}' end)
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.swamp_set_permission(uuid, text, uuid, text, public.swamp_role, uuid[]) from public, anon;
grant execute on function public.swamp_set_permission(uuid, text, uuid, text, public.swamp_role, uuid[]) to authenticated;
