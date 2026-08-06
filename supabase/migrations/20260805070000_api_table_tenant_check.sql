-- Restore the `is distinct from` tenant check in swamp_api_table.
--
-- 20260716090000_anon_grants.sql deliberately changed this comparison from `<>`
-- to `is distinct from`, with a paragraph explaining why:
--
--     with p_ctx = '{}' the right operand is NULL, `<>` yields NULL, and
--     `if NULL` does not fire — so a caller who simply omitted baseId skipped
--     the tenant check entirely.
--
-- 20260717010000_leadgen_platform.sql then redefined the whole function to add
-- the tableIds pin, and — being a later migration — silently reverted the
-- comparison. This restores it, keeping the tableIds pin.
--
-- NOT currently exploitable: swamp_api_table is not granted to anon, and every
-- caller passes a ctx built by swamp_api_require, which always sets baseId. It
-- is defence in depth that was lost by accident, and the new swamp_api_aggregate
-- (20260805050000) is one more function standing on it.

create or replace function public.swamp_api_table(p_ctx jsonb, p_table_id uuid)
returns public.tables
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.tables;
begin
  select * into v_t
    from public.tables
   where id = p_table_id and deleted_at is null;

  -- `is distinct from`, NOT `<>`: a NULL baseId in the ctx must FAIL the check,
  -- not skip it.
  if v_t.id is null or v_t.base_id is distinct from (p_ctx->>'baseId')::uuid then
    raise exception 'swamp: no such table' using errcode = '42P01';
  end if;

  -- A token pinned to specific tables reaches only those.
  if jsonb_typeof(p_ctx->'tableIds') = 'array'
     and jsonb_array_length(p_ctx->'tableIds') > 0
     and not (p_ctx->'tableIds' ? p_table_id::text)
  then
    raise exception 'swamp: no such table' using errcode = '42P01';
  end if;

  return v_t;
end
$$;

-- `create or replace` keeps the existing ACL (authenticated + service_role, no
-- anon) — restated here only so the convention is visible at the call site.
revoke all on function public.swamp_api_table(jsonb, uuid) from public, anon;
grant execute on function public.swamp_api_table(jsonb, uuid) to authenticated, service_role;
