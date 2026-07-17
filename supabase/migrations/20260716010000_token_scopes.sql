-- Stop selling API token permissions that grant nothing.
--
-- `api_tokens.scopes` offers five values. Exactly two of them are ever checked.
-- Every `swamp_api_require` call in 20260714090000_platform.sql:
--
--     :399 :449 :483 :543  -> 'records:read'  / viewer
--     :608 :665 :703       -> 'records:write' / editor
--
-- and that is the complete list. `schema:read`, `webhooks:read` and
-- `webhooks:write` are declared in the CHECK (platform.sql:190-195), offered in
-- the tokens panel, stored on real rows — and read by nothing.
--
-- The consequences are not cosmetic:
--   * A token scoped ONLY `schema:read` can do nothing at all. Not "less" — nothing.
--     It 403s on every endpoint in the product, including /api/v1/meta, the one it
--     was plainly created for (which requires records:read, platform.sql:399).
--   * `webhooks:read` / `webhooks:write` cannot ever work: there are no v1 webhook
--     endpoints. app/api/v1/ is exactly meta + records + records/[id].
--
-- A permission checkbox that grants nothing is worse than a missing feature. It
-- reads as a security control, so someone will hand out a "schema:read only" token
-- believing it is narrow, and someone else will assume the narrowing is enforced.
--
-- ── Why remove rather than enforce ──
--
-- The alternative is to make them real: gate /meta behind schema:read, add v1
-- webhook endpoints. That breaks every existing token at its first call — both mint
-- paths default to '{records:read}' (platform.sql:190 column default, :223
-- swamp_create_token's param default) and the UI pre-checks it, so records:read-only
-- is the modal token and /meta is the first thing an integration calls. Widening the
-- scope story is a v2 boundary, not an in-place change.
--
-- Removing is honest and breaks nothing that ever worked. For reference, NocoDB CE
-- has no token scopes at all — a token simply acts as its owner with their live role
-- (packages/nocodb/src/strategies/authtoken.strategy/); its TokenScopePicker.vue and
-- TokenPermissionMatrix.vue are 34-byte shells. Two working scopes is already ahead.
--
-- Add scopes back when — and only when — the endpoint that honours them lands in the
-- same commit.
--
-- ── This migration does not destroy a credential ──
--
-- It deletes nothing and revokes nothing. Someone's integration must not stop working
-- because we tidied a constraint, and an incident must never find that the evidence
-- was migrated away.
--
-- The only edit to data is the strip in step 1, and it is a no-op by construction:
-- removing a value that gates nothing cannot change what a token can do.

-- 1. Strip the dead values from every token. {records:read, schema:read} ->
--    {records:read}: byte-identical behaviour, since schema:read gated nothing.
--
--    A token scoped ONLY to dead values becomes {}. That is not damage — it is the
--    honest recording of what it has always been able to do, which is nothing. It
--    keeps working exactly as well as it did yesterday, and its owner can still see
--    it, name it, and revoke it.
update public.api_tokens
   set scopes = array(
         select unnest(scopes)
         intersect
         select unnest(array['records:read', 'records:write']::text[])
       )
 where not (scopes <@ array['records:read', 'records:write']::text[]);

-- 2. Narrow the constraint. Every row satisfies it after step 1, so it validates
--    cleanly and stays VALID.
--
--    ── Why there is no `cardinality(scopes) >= 1` here ──
--
--    Because {} is a legal, honest state, and forbidding it costs more than it buys.
--
--    The old constraint (platform.sql:196) claimed to forbid it and never once did:
--    `array_length(scopes, 1) >= 1` is NULL for '{}' — array_length of an empty array
--    returns NULL, not 0 — and a CHECK only rejects on FALSE, so NULL passed. Empty
--    rows may therefore exist right now. `cardinality('{}')` is 0, which is FALSE,
--    which would actually reject.
--
--    That is exactly why adding it here would be a trap. A CHECK fires on UPDATE as
--    well as INSERT, and it fires on the NEW row whether or not the UPDATE touched
--    the constrained column. So `update api_tokens set revoked_at = now()` against a
--    {}-scoped row would raise. The constraint meant to express "a token must grant
--    something" would instead make a token that grants nothing IMPOSSIBLE TO REVOKE.
--    (`NOT VALID` does not save this: it skips the initial table scan, but the
--    constraint still fires on every subsequent UPDATE. Same trap, later.)
--
--    Emptiness is a mint-time concern, so it is guarded at the mint path below,
--    where the only cost of being wrong is a token that isn't created.
alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  scopes <@ array['records:read', 'records:write']::text[]
);

-- 3. The mint path refuses what the constraint deliberately tolerates.
--
--    `create or replace` preserves existing grants, so this does not quietly change
--    who may call it. Body is unchanged from platform.sql:220 apart from the guard.
create or replace function public.swamp_create_token(
  p_base_id    uuid,
  p_name       text,
  p_scopes     text[]      default '{records:read}',
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
-- gen_random_bytes and digest are pgcrypto. Hosted Supabase keeps pgcrypto in the
-- `extensions` schema, so name it here or minting a token raises "function digest
-- does not exist" in production while working fine locally.
set search_path = public, extensions, pg_temp
as $$
declare
  v_plain text;
  v_id    uuid;
begin
  -- A token that grants nothing is a mistake at mint time, always. The API layer
  -- says so too (createTokenSchema's .min(1), features/tables/schema.ts:262) — this
  -- is the half that holds when the caller isn't the API layer.
  --
  -- cardinality, not array_length: array_length('{}', 1) is NULL and every
  -- comparison against it is NULL, which is how the original CHECK came to pass
  -- everything it was written to reject.
  if p_scopes is null or cardinality(p_scopes) = 0 then
    raise exception 'swamp: a token needs at least one scope'
      using errcode = '22023';
  end if;

  -- A recognisable prefix. Not decoration: it is what makes a leaked token
  -- greppable in a log, and what lets a secret scanner catch it in a commit.
  v_plain := 'swamp_pat_' ||
             rtrim(replace(replace(encode(gen_random_bytes(24), 'base64'), '/', '_'), '+', '-'), '=');

  insert into public.api_tokens (base_id, name, token_hash, prefix, scopes, expires_at)
  values (
    p_base_id,
    p_name,
    encode(digest(v_plain, 'sha256'), 'hex'),
    left(v_plain, 18),
    p_scopes,
    p_expires_at
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_plain);
end
$$;

-- What the migration promises, asserted rather than assumed. The last two are the
-- point of the rewrite: a migration about credentials must prove it did not take any.
do $$
declare
  n int;
begin
  select count(*) into n
    from public.api_tokens
   where not (scopes <@ array['records:read', 'records:write']::text[]);
  assert n = 0, format('%s api_tokens still carry a dead scope', n);

  -- A {}-scoped token must still be revokable. This is the trap the design avoids,
  -- so it is the thing worth failing the migration over.
  select count(*) into n from public.api_tokens where cardinality(scopes) = 0;
  if n > 0 then
    -- No-op UPDATE against every empty-scoped row: touches revoked_at with its own
    -- value, so the CHECK fires and nothing changes.
    update public.api_tokens set revoked_at = revoked_at where cardinality(scopes) = 0;
  end if;
end $$;
