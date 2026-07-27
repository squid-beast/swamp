-- ════════════════════════════════════════════════════════════════════════════
-- Ingest reliability hardening.
--
-- Two independent guarantees for POST /api/ingest/:tableId, both living in
-- SECURITY DEFINER SQL (never the route), because the ingest path runs on the
-- anon client with no ambient authority:
--
--   ingest_idempotency  — a retried POST carrying the same Idempotency-Key
--                         replays the original response instead of creating a
--                         second lead. Modelled on the rate_limits pattern in
--                         20260717010000_leadgen_platform.sql: RLS on, no policy,
--                         revoked from anon, reached only through functions.
--
--   swamp_api_upsert    — the same person submitting twice updates one record
--                         instead of duplicating it. Modelled exactly on
--                         swamp_api_insert in 20260716100000_api_computed.sql:
--                         same authority preamble, same computed-value projection.
--
-- Same philosophy as the surrounding migrations: authority is decided inside the
-- function, not in a route handler one forgotten `if` away from being no guard.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── 1. Idempotency store ───────────────────────────────────────────────────
--
-- Keyed by sha256(token:tableId:clientKey) — the raw token never lands here.
-- `response` is null while a request is in flight and holds the stored body once
-- it finishes, so a retry can be told apart from a concurrent duplicate.

create table public.ingest_idempotency (
  key        text primary key,   -- sha256(token:tableId:clientKey), never the raw token
  response   jsonb,              -- null while in flight
  created_at timestamptz not null default now()
);

-- No policy: the table is reached ONLY through the functions below (SECURITY
-- DEFINER). A client cannot read another caller's stored response nor forge one.
alter table public.ingest_idempotency enable row level security;

-- A table created after the global `revoke ... from anon` still gets anon SELECT
-- back through Supabase's default privileges. Strip it: nothing reaches this
-- table except the functions, and the anon-surface guard asserts exactly that.
revoke all on table public.ingest_idempotency from anon;


/**
 * Claim an idempotency key.
 *
 * `insert .. on conflict do nothing` is the whole race handler: the first caller
 * for a key inserts the in-flight row and gets {"status":"new"} (proceed); a
 * second caller conflicts and inserts nothing, then reads the existing row —
 * {"status":"done", "response":…} if the first call already stored its body
 * (replay it), or {"status":"in_flight"} if it has not (a concurrent duplicate →
 * the route answers 409).
 *
 * Rows past the TTL are purged opportunistically on the way in, exactly as
 * swamp_rate_limit rolls its window — so an expired key is a fresh key, which is
 * the point of a TTL. Default 24h is enforced by the caller passing p_ttl_seconds.
 */
create function public.swamp_idempotency_claim(
  p_key         text,
  p_ttl_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now      timestamptz := now();
  v_count    int;
  v_existing public.ingest_idempotency;
begin
  delete from public.ingest_idempotency
   where created_at < v_now - make_interval(secs => p_ttl_seconds);

  insert into public.ingest_idempotency (key, response, created_at)
  values (p_key, null, v_now)
  on conflict (key) do nothing;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    return jsonb_build_object('status', 'new');
  end if;

  select * into v_existing
    from public.ingest_idempotency
   where key = p_key;

  if v_existing.response is not null then
    return jsonb_build_object('status', 'done', 'response', v_existing.response);
  end if;

  return jsonb_build_object('status', 'in_flight');
end
$$;


/**
 * Record the response body for a claimed key, so a later retry replays it. Best
 * effort by design: if the key row is gone (purged past TTL between claim and
 * finish) the update simply touches nothing.
 */
create function public.swamp_idempotency_finish(
  p_key      text,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ingest_idempotency
     set response = p_response
   where key = p_key;
end
$$;


-- ─── 2. Upsert-by-field ─────────────────────────────────────────────────────
--
-- Modelled directly on swamp_api_insert (20260716100000_api_computed.sql): same
-- authority preamble, same array/length guards, same computed-value projection
-- via swamp_computed_values. Everything it can do it can do because the token
-- proved a records:write scope and editor role for this exact table.
--
-- Matching is one query per call, not per record: the batch's key values are
-- looked up once against the live rows to build an id-by-normalised-key map,
-- then each incoming record is either inserted (miss) or merged (hit) via the
-- same helpers the strict API uses. Normalisation is lower(btrim(value)), so
-- "  Alice@X.com " and "alice@x.com" are the same person.

create function public.swamp_api_upsert(
  p_token     text,
  p_table_id  uuid,
  p_records   jsonb,   -- [{ "fields": { "fld_x": 1 } }, ...]
  p_key_field text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx      jsonb;
  v_table    public.tables;
  v_order    numeric;
  v_row      jsonb;
  v_fields   jsonb;
  v_ids      uuid[] := '{}';
  v_id       uuid;
  v_computed jsonb;
  v_keyval   text;
  v_norm     text;
  v_map      jsonb  := '{}'::jsonb;   -- normalised key -> existing record id (text)
  v_dedup    jsonb  := '{}'::jsonb;   -- normalised key -> incoming fields (last wins)
  v_patches  jsonb  := '[]'::jsonb;
  v_created  int    := 0;
  v_updated  int    := 0;
  v_skipped  int    := 0;
begin
  v_ctx   := public.swamp_api_require(p_token, 'records:write', 'editor');
  v_table := public.swamp_api_table(v_ctx, p_table_id);

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'swamp: records must be an array';
  end if;
  if jsonb_array_length(p_records) > 1000 then
    raise exception 'swamp: at most 1000 records per call';
  end if;

  -- Refuse a computed/read-only key field, or one that is not a field at all:
  -- both are absent from the writable-keys set, and upserting on something the
  -- caller cannot write would match nothing and insert everything.
  if not (p_key_field = any(public.swamp_writable_keys(p_table_id))) then
    raise exception 'swamp: cannot upsert on "%" — it is not a writable field of this table', p_key_field;
  end if;

  -- One lookup over the live rows builds the id-by-normalised-key map. If the
  -- table already holds two live rows sharing a normalised key value, fail loudly
  -- rather than silently updating an arbitrary one.
  for v_norm, v_id in
    select lower(btrim(r.data->>p_key_field)), r.id
      from public.records r
     where r.table_id = p_table_id
       and r.deleted_at is null
       and nullif(btrim(coalesce(r.data->>p_key_field, '')), '') is not null
  loop
    if v_map ? v_norm then
      raise exception 'swamp: the table has duplicate values for "%" — cannot upsert unambiguously; deduplicate first', p_key_field;
    end if;
    v_map := v_map || jsonb_build_object(v_norm, v_id::text);
  end loop;

  -- Dedupe the incoming batch by normalised key (last wins), and skip records
  -- whose key value is empty (they cannot be matched or safely inserted).
  for v_row in select * from jsonb_array_elements(p_records) loop
    v_fields := coalesce(v_row->'fields', '{}'::jsonb);
    v_keyval := btrim(coalesce(v_fields->>p_key_field, ''));

    if v_keyval = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_dedup := v_dedup || jsonb_build_object(lower(v_keyval), v_fields);
  end loop;

  select coalesce(max(sort_order), 0) into v_order
    from public.records
   where table_id = p_table_id and deleted_at is null;

  for v_norm, v_fields in select key, value from jsonb_each(v_dedup) loop
    if v_map ? v_norm then
      -- Hit: merge only the sent keys, exactly like swamp_api_patch.
      v_id := (v_map->>v_norm)::uuid;
      v_patches := v_patches || jsonb_build_object(
        'id',     v_id::text,
        'values', public.swamp_pick_writable(p_table_id, v_fields)
      );
      v_ids := v_ids || v_id;
      v_updated := v_updated + 1;
    else
      -- Miss: insert like swamp_api_insert.
      v_order := v_order + 1;
      insert into public.records (table_id, base_id, data, sort_order)
      values (
        p_table_id,
        v_table.base_id,
        public.swamp_pick_writable(p_table_id, v_fields),
        v_order
      )
      returning id into v_id;

      v_ids := v_ids || v_id;
      v_created := v_created + 1;
    end if;
  end loop;

  perform public.swamp_patch_records(p_table_id, v_patches);

  -- After the writes: a formula over a row's own values can only be computed once
  -- the row reflects the values just written.
  v_computed := public.swamp_computed_values(p_table_id, v_ids);

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'records', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',     r.id,
                 'fields', r.data || coalesce(
                   (select c->'values'
                      from jsonb_array_elements(v_computed) c
                     where (c->>'id')::uuid = r.id),
                   '{}'::jsonb
                 ),
                 'createdTime', r.created_at
               )
               order by r.sort_order
             )
        from public.records r
       where r.id = any(v_ids) and r.table_id = p_table_id and r.deleted_at is null
    ), '[]'::jsonb)
  );
end
$$;


-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- All three are called from the anon public client (the ingest route runs on it,
-- same as swamp_rate_limit and the swamp_api_* functions). The token is the
-- credential for the upsert; the idempotency functions only touch app-hashed
-- opaque keys. Granted exactly like swamp_rate_limit — NOT revoked from public,
-- matching the other token-authed API functions.
grant execute on function public.swamp_idempotency_claim(text, int)
  to anon, authenticated, service_role;
grant execute on function public.swamp_idempotency_finish(text, jsonb)
  to anon, authenticated, service_role;
grant execute on function public.swamp_api_upsert(text, uuid, jsonb, text)
  to anon, authenticated, service_role;
