-- ════════════════════════════════════════════════════════════════════════════
-- Lead-gen hardening for the public ingress surface.
--
-- SWAMP already lets an anonymous form submit a record and lets a token POST one
-- from another server. This migration makes that surface safe to point at the
-- open internet:
--
--   rate_limits           — a fixed-window counter, so a public form or a token
--                           cannot be turned into a firehose
--   api_tokens.table_ids  — a token may be pinned to specific tables, so a
--                           lead-ingest key can write to Leads and NOTHING else
--
-- Same philosophy as 20260714090000_platform.sql: every check lives in a
-- SECURITY DEFINER function that the caller must pass through. A guard in a route
-- handler is one forgotten `if` away from being no guard.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Rate limiting ──────────────────────────────────────────────────────────
--
-- A fixed-window counter keyed by an opaque bucket string. The app decides what
-- a bucket means — "this token", "this form from this IP" — and the database
-- only counts. Kept in Postgres rather than in process memory because the app
-- runs as many short-lived serverless functions with no shared memory between
-- them: an in-process counter on Vercel counts to one, forever, per cold start.

create table public.rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0
);

-- No policy: the table is reached ONLY through swamp_rate_limit (SECURITY
-- DEFINER). A client cannot read how close it is to the limit, nor reset it.
alter table public.rate_limits enable row level security;

-- A table created after the global `revoke ... from anon` still gets anon SELECT
-- back through Supabase's default privileges. Strip it: nothing reaches this
-- table except the function, and the anon-surface guard asserts exactly that.
revoke all on table public.rate_limits from anon;


/**
 * Count one hit against a bucket. Returns TRUE if it is allowed, FALSE if the
 * bucket is over its limit for the current window.
 *
 * The window is a tumbling one: the first hit stamps window_start, and once
 * `p_window_seconds` have passed the count resets on the next hit. It is
 * deliberately simple — a sliding window needs a row per hit, and the point of a
 * rate limit is to be cheaper than the thing it protects.
 *
 * The whole read-modify-write is a single INSERT .. ON CONFLICT .. RETURNING, so
 * two requests racing the same bucket cannot both read a stale count: the second
 * one blocks on the row lock the first one takes.
 */
create function public.swamp_rate_limit(
  p_key            text,
  p_limit          int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now   timestamptz := now();
  v_count int;
begin
  insert into public.rate_limits (bucket, window_start, count)
  values (p_key, v_now, 1)
  on conflict (bucket) do update
    set count = case
          when public.rate_limits.window_start
               < v_now - make_interval(secs => p_window_seconds)
          then 1
          else public.rate_limits.count + 1
        end,
        window_start = case
          when public.rate_limits.window_start
               < v_now - make_interval(secs => p_window_seconds)
          then v_now
          else public.rate_limits.window_start
        end
  returning count into v_count;

  return v_count <= p_limit;
end
$$;

-- Reached without a session, by the public form and the token API.
grant execute on function public.swamp_rate_limit(text, int, int)
  to anon, authenticated, service_role;


-- ─── Per-table token scope ──────────────────────────────────────────────────
--
-- Until now a token was scoped to a whole base: a `records:write` key could
-- write every table in it. For a lead-gen key that another server holds, that is
-- more than it needs — it should write Leads and be unable to touch anything
-- else, so a leak is contained to one table.
--
-- table_ids is that pin. EMPTY means "every table in the base", which is the
-- existing behaviour, so every token minted before this migration keeps working
-- unchanged.

alter table public.api_tokens
  add column table_ids uuid[] not null default '{}';


/**
 * Mint a token, now with an optional table pin.
 *
 * `create or replace` cannot add a parameter — that makes an OVERLOAD, and a
 * four-argument call would then be ambiguous between the old and new function.
 * So the previous definition (20260716010000_token_scopes.sql) is dropped and
 * replaced by this five-argument one. Its fifth argument defaults to '{}', so
 * every existing four-argument caller — the tokens route, the integration
 * harness — resolves to it and behaves exactly as before.
 *
 * SECURITY INVOKER, unchanged: minting is an ordinary insert governed by RLS,
 * and running as the invoker is also what lets the table-pin validation below
 * see the caller's own tables.
 */
drop function if exists public.swamp_create_token(uuid, text, text[], timestamptz);

create function public.swamp_create_token(
  p_base_id    uuid,
  p_name       text,
  p_scopes     text[]      default '{records:read}',
  p_expires_at timestamptz default null,
  p_table_ids  uuid[]      default '{}'
)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_plain text;
  v_id    uuid;
  v_valid int;
begin
  if p_scopes is null or cardinality(p_scopes) = 0 then
    raise exception 'swamp: a token needs at least one scope'
      using errcode = '22023';
  end if;

  -- A pinned table must actually be in this base, and be one the minter can see.
  -- Running as the invoker, the RLS on `tables` already hides tables in other
  -- bases, so a mismatch here means a bad id, not a permission probe.
  if p_table_ids is not null and cardinality(p_table_ids) > 0 then
    select count(*) into v_valid
      from public.tables t
     where t.id = any(p_table_ids)
       and t.base_id = p_base_id
       and t.deleted_at is null;

    if v_valid <> cardinality(p_table_ids) then
      raise exception 'swamp: a pinned table does not belong to this base'
        using errcode = '22023';
    end if;
  end if;

  v_plain := 'swamp_pat_' ||
             rtrim(replace(replace(encode(gen_random_bytes(24), 'base64'), '/', '_'), '+', '-'), '=');

  insert into public.api_tokens
    (base_id, name, token_hash, prefix, scopes, expires_at, table_ids)
  values (
    p_base_id,
    p_name,
    encode(digest(v_plain, 'sha256'), 'hex'),
    left(v_plain, 18),
    p_scopes,
    p_expires_at,
    coalesce(p_table_ids, '{}')
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_plain);
end
$$;

-- A freshly created function carries a default EXECUTE to PUBLIC, and anon
-- inherits PUBLIC — and Supabase's default privileges also grant anon directly,
-- so both have to go. Minting is an authenticated action (RLS on api_tokens would
-- refuse an anon insert anyway, but defence in depth is the rule here).
revoke all on function
  public.swamp_create_token(uuid, text, text[], timestamptz, uuid[]) from public, anon;

grant execute on function
  public.swamp_create_token(uuid, text, text[], timestamptz, uuid[])
  to authenticated, service_role;


/**
 * Resolve a token, now carrying its table pin in the context.
 *
 * Unchanged from 20260714090000_platform.sql except for the `tableIds` key. Every
 * failure mode — missing, revoked, expired, owner removed — is byte-identical.
 */
create or replace function public.swamp_token_context(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_t    public.api_tokens;
  v_role public.swamp_role;
begin
  select * into v_t
    from public.api_tokens
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if v_t.id is null then
    raise exception 'swamp: invalid API token' using errcode = '28000';
  end if;

  if v_t.revoked_at is not null then
    raise exception 'swamp: this API token was revoked' using errcode = '28000';
  end if;

  if v_t.expires_at is not null and v_t.expires_at <= now() then
    raise exception 'swamp: this API token has expired' using errcode = '28000';
  end if;

  v_role := public.swamp_base_role_of(v_t.base_id, v_t.user_id);

  if v_role is null then
    raise exception 'swamp: this token''s owner is no longer a member of the base'
      using errcode = '28000';
  end if;

  if v_t.last_used_at is null or v_t.last_used_at < now() - interval '1 minute' then
    update public.api_tokens set last_used_at = now() where id = v_t.id;
  end if;

  return jsonb_build_object(
    'tokenId',  v_t.id,
    'baseId',   v_t.base_id,
    'userId',   v_t.user_id,
    'scopes',   to_jsonb(v_t.scopes),
    'tableIds', to_jsonb(coalesce(v_t.table_ids, '{}'::uuid[])),
    'role',     v_role
  );
end
$$;


/**
 * The table, if it is in the token's base AND (when the token is pinned) in the
 * token's allow-list. A table outside the pin is reported as "no such table" —
 * the same answer as a table in another base, so a pinned token cannot even
 * confirm which other tables exist.
 *
 * Same signature as 20260714090000_platform.sql, so every caller
 * (swamp_api_query / get / insert / patch / delete / count) gains the pin check
 * for free.
 */
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

  if v_t.id is null or v_t.base_id <> (p_ctx->>'baseId')::uuid then
    raise exception 'swamp: no such table' using errcode = '42P01';
  end if;

  if jsonb_typeof(p_ctx->'tableIds') = 'array'
     and jsonb_array_length(p_ctx->'tableIds') > 0
     and not (p_ctx->'tableIds' ? p_table_id::text)
  then
    raise exception 'swamp: no such table' using errcode = '42P01';
  end if;

  return v_t;
end
$$;


/**
 * The base's shape — now narrowed to the token's tables when it is pinned. A
 * pinned key learns the keys of the tables it may touch and no others, so /meta
 * does not become the schema leak that the table pin exists to prevent.
 */
create or replace function public.swamp_api_meta(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx  jsonb;
  v_base uuid;
  v_tids uuid[];
begin
  v_ctx  := public.swamp_api_require(p_token, 'records:read', 'viewer');
  v_base := (v_ctx->>'baseId')::uuid;

  select array(select jsonb_array_elements_text(coalesce(v_ctx->'tableIds', '[]'::jsonb))::uuid)
    into v_tids;

  return jsonb_build_object(
    'base', (select jsonb_build_object('id', b.id, 'name', b.name)
               from public.bases b where b.id = v_base),
    'tables', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'fields', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', f.id, 'name', f.name, 'key', f.key,
                'type', f.type, 'options', f.options,
                'isPrimary', f.is_primary,
                'readOnly', f.type in ('link','lookup','rollup','formula','count',
                                       'button','barcode','qr',
                                       'createdTime','modifiedTime','createdBy','modifiedBy')
              ) order by f.sort_order
            )
              from public.fields f
             where f.table_id = t.id and f.deleted_at is null
          ), '[]'::jsonb)
        ) order by t.sort_order
      )
        from public.tables t
       where t.base_id = v_base and t.deleted_at is null
         and (cardinality(v_tids) = 0 or t.id = any(v_tids))
    ), '[]'::jsonb)
  );
end
$$;


-- The API meta function is anon-reachable by design (it authenticates the token
-- itself). The others are internals, revoked from anon in platform.sql; the
-- replacements above inherit those revokes because they keep the same names, but
-- re-grant meta explicitly to be certain a `create or replace` did not reset it.
grant execute on function public.swamp_api_meta(text) to anon;


-- What the migration promises, asserted.
do $$
declare
  n int;
begin
  -- Every existing token defaults to the empty pin, i.e. whole-base access — so
  -- nothing that worked yesterday stops working.
  select count(*) into n from public.api_tokens where table_ids is null;
  assert n = 0, 'table_ids must never be null';
end $$;
