-- Sharing reach: vanity slugs, shared bases, and a token-API aggregate.
--
-- ── Vanity slug ──
-- `views.share_slug` — a human-readable alias for a share link. A slug is
-- GUESSABLE BY CONSTRUCTION; the 128-bit share_id is the security property, and
-- choosing a slug trades it away. The password option is the answer for slugged
-- shares that shouldn't be public; docs say so.
--
-- ── Shared base ──
-- The safe shape, and the only shape: swamp_shared_base returns the base's name
-- and the views that are THEMSELVES already shared — no records, no field
-- metadata. Every record read still flows through swamp_shared_records with its
-- per-view allow-list. A whole-base share adds ZERO new record-reading anon
-- surface.
--
-- ── swamp_api_aggregate ──
-- The MCP server runs on the anon client with a bearer; swamp_aggregate is
-- authenticated-only. Same wrapper pattern as every swamp_api_*: token + scope
-- + live role checked at entry, table pinned to the token's base.

-- ─── Vanity slug ────────────────────────────────────────────────────────────

alter table public.views
  add column share_slug text
  check (share_slug is null or share_slug ~ '^[a-z0-9][a-z0-9-]{2,59}$');

create unique index views_share_slug_uniq on public.views (share_slug)
  where share_slug is not null and deleted_at is null;

-- Revoke must be TOTAL, and must FAIL LOUDLY.
--
-- Two fixes in one replacement:
--   1. swamp_share_view mints a fresh random share_id every time, so an old
--      id-link stays dead after a re-share — but a slug does not rotate, and
--      leaving it behind would hand the previous audience their access back the
--      moment the view is shared again. Clear it with the id.
--   2. A bare UPDATE that RLS filters to zero rows returns success, and the
--      route then reports "unshared" for a link that is still live. Someone who
--      believes they revoked access and hasn't is worse off than someone who got
--      an error. Raise instead.
create or replace function public.swamp_unshare_view(p_view_id uuid)
returns void
language plpgsql
-- `create or replace` resets any attribute the new definition omits, so pin the
-- path explicitly rather than inheriting the caller's — the convention every
-- other function in this migration follows.
set search_path = public, pg_temp
as $$
begin
  update public.views
     set share_id = null,
         share_password_hash = null,
         share_slug = null
   where id = p_view_id;

  if not found then
    raise exception 'swamp: view % not found, or you cannot unshare it', p_view_id
      using errcode = '42501';
  end if;
end
$$;

create or replace function public.swamp_resolve_share(
  p_share_id text,
  p_password text default null
)
returns public.views
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_view public.views;
begin
  -- Two spellings, resolved in a DEFINED ORDER — the random id first, then the
  -- slug. `id = x OR slug = x` in one SELECT INTO would let a view whose slug
  -- happens to equal another view's share_id answer at that view's URL, with
  -- plpgsql picking between them arbitrarily (SELECT INTO does not raise on
  -- multiple rows). A share_id is the stronger credential, so it always wins.
  select * into v_view
    from public.views
   where share_id = p_share_id
     and deleted_at is null;

  if v_view.id is null then
    select * into v_view
      from public.views
     where share_slug = p_share_id
       and share_id is not null     -- a slug on an UNSHARED view resolves nothing
       and deleted_at is null;
  end if;

  if v_view.id is null then
    raise exception 'swamp: no such shared view';
  end if;

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

-- ─── Shared base ────────────────────────────────────────────────────────────

alter table public.bases
  add column share_id text unique,
  add column share_password_hash text;

create or replace function public.swamp_share_base(
  p_base_id  uuid,
  p_password text default null
)
returns text
language plpgsql
security invoker      -- RLS decides who may share; base writes are creator+
set search_path = public, extensions, pg_temp
as $$
declare
  v_id text;
begin
  v_id := replace(replace(rtrim(encode(gen_random_bytes(16), 'base64'), '='), '+', '-'), '/', '_');

  update public.bases
     set share_id = v_id,
         share_password_hash = case when p_password is null or p_password = ''
                                    then null
                                    else crypt(p_password, gen_salt('bf')) end
   where id = p_base_id;

  if not found then
    raise exception 'swamp: base % not found, or you cannot share it', p_base_id;
  end if;

  return v_id;
end
$$;

-- Fails CLOSED, like swamp_share_base: the members page renders the share
-- control to anyone who can read the base, but the UPDATE is creator-gated. A
-- viewer clicking "Stop sharing" against a silent UPDATE would be told the link
-- was revoked while it stayed live — the one outcome worse than an error.
create or replace function public.swamp_unshare_base(p_base_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.bases
     set share_id = null, share_password_hash = null
   where id = p_base_id;

  if not found then
    raise exception 'swamp: base % not found, or you cannot unshare it', p_base_id
      using errcode = '42501';
  end if;
end
$$;

-- The ONLY anon-reachable part. Returns names and already-shared views. Nothing
-- else — a base has no per-view allow-list to derive, so it must never return
-- records or field metadata itself.
create or replace function public.swamp_shared_base(
  p_share_id text,
  p_password text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base public.bases;
begin
  select * into v_base from public.bases
   where share_id = p_share_id and deleted_at is null;

  if v_base.id is null then
    raise exception 'swamp: no such shared base';
  end if;

  if v_base.share_password_hash is not null then
    if p_password is null
       or crypt(p_password, v_base.share_password_hash) <> v_base.share_password_hash
    then
      raise exception 'swamp: password required' using errcode = '28000';
    end if;
  end if;

  return jsonb_build_object(
    'base', jsonb_build_object('name', v_base.name),
    'views', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'shareId', coalesce(v.share_slug, v.share_id),
          'name', v.name,
          'type', v.type,
          'tableName', t.name
        ) order by t.name, v.name
      )
      from public.views v
      join public.tables t on t.id = v.table_id and t.deleted_at is null
      where v.base_id = v_base.id
        and v.share_id is not null
        and v.deleted_at is null
    ), '[]'::jsonb)
  );
end
$$;

-- ─── Token-API aggregate (for MCP and REST) ─────────────────────────────────

create or replace function public.swamp_api_aggregate(
  p_token    text,
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb,
  p_aggs     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx jsonb;
begin
  v_ctx := public.swamp_api_require(p_token, 'records:read', 'viewer');
  perform public.swamp_api_table(v_ctx, p_table_id);
  return public.swamp_aggregate(p_table_id, p_spec, p_aggs);
end
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- swamp_shared_base and swamp_api_aggregate join the anon allowlist (and the
-- ALLOWED list in tests/integration/anon-surface.test.ts, with justifications):
-- the first returns only names of things ALREADY shared, after its own password
-- check; the second is entered through swamp_api_require, where the token is
-- the credential and the role is re-read live. Session-side share management
-- stays authenticated-only.

revoke all on function public.swamp_share_base(uuid, text) from public, anon;
grant execute on function public.swamp_share_base(uuid, text) to authenticated;

revoke all on function public.swamp_unshare_base(uuid) from public, anon;
grant execute on function public.swamp_unshare_base(uuid) to authenticated;

revoke all on function public.swamp_shared_base(text, text) from public, anon;
grant execute on function public.swamp_shared_base(text, text) to anon, authenticated;

revoke all on function public.swamp_api_aggregate(text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.swamp_api_aggregate(text, uuid, jsonb, jsonb) to anon, authenticated;
