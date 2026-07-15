-- ════════════════════════════════════════════════════════════════════════════
-- Phase 6 — the platform.
--
--   api_tokens          — machine access, scoped, capped by the owner's live role
--   webhooks            — events out, with a condition tree and field scoping
--   webhook_deliveries  — the call log, with retries
--   file_references     — attachments in Supabase Storage, and their garbage
--   button              — a field whose value is an action
--
-- ── The one idea this file is built on ──
--
-- An API token is NOT a second identity. It is a **narrower** view of an identity
-- that already exists. Everything below follows from that:
--
--   • A token belongs to a user AND a base.
--   • Its effective role is recomputed on EVERY call from live membership. Demote
--     the owner to viewer and their write token stops writing — in the next
--     request, not at the next rotation.
--   • Its scopes can only narrow that role further. They can never widen it.
--
-- The alternative — storing the role on the token — is how "we removed him in
-- March and his integration was still writing to prod in July" happens.
--
-- The same pattern as the sharing migration: a set of SECURITY DEFINER functions
-- is the ONLY door, and `anon` reaches records through nothing else.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Who is acting? ─────────────────────────────────────────────────────────
--
-- Everything in the app so far has answered that with `auth.uid()`. The REST API
-- has no session — it presents a token — so `auth.uid()` is NULL, and every write
-- would land with a null `created_by` and an anonymous entry in the history.
--
-- So the API functions set a transaction-local actor, and the stamping and audit
-- triggers read THIS instead of auth.uid() directly. "Who edited this?" gets the
-- right answer whether the edit came from a browser or from Zapier.

create function public.swamp_actor()
returns uuid
language sql stable
as $$
  select coalesce(
    auth.uid(),
    nullif(current_setting('swamp.actor', true), '')::uuid
  )
$$;

-- Recreate the two triggers that stamp identity, so they go through swamp_actor().
--
-- Everything else about this function is UNCHANGED, and deliberately so — the
-- `created_by = old.created_by` line is what makes authorship un-forgeable, and
-- dropping it while "just swapping auth.uid() for swamp_actor()" would be a very
-- quiet way to let a client claim someone else created a record.
create or replace function public.swamp_stamp_record()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_by = public.swamp_actor();
    new.updated_by = public.swamp_actor();
  else
    new.updated_at = now();
    new.updated_by = public.swamp_actor();
    new.created_by = old.created_by;   -- not forgeable
    new.created_at = old.created_at;
  end if;
  return new;
end
$$;


-- The history has to say who, and "who" is now sometimes a token. Same body as
-- the Phase 5 trigger; auth.uid() becomes swamp_actor(). Without this, every write
-- made through the API lands in the audit log attributed to nobody — and an audit
-- log full of "someone changed this" is the thing we built it not to be.
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


-- ─── A role, for someone who is not you ─────────────────────────────────────
--
-- `swamp_base_role()` answers "what may *I* do here" and reads auth.uid(). Token
-- auth has to ask the same question about a DIFFERENT user — the token's owner —
-- so it needs a variant that takes the user id.
--
-- SECURITY DEFINER: it reads base_members and workspace_members, which the caller
-- (often `anon`, holding only a token) cannot read at all.

create function public.swamp_base_role_of(p_base_id uuid, p_user_id uuid)
returns public.swamp_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select bm.role from public.base_members bm
      where bm.base_id = p_base_id and bm.user_id = p_user_id),
    (select wm.role from public.workspace_members wm
       join public.bases b on b.id = p_base_id
      where wm.workspace_id = b.workspace_id and wm.user_id = p_user_id)
  )
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- API tokens
-- ════════════════════════════════════════════════════════════════════════════

create table public.api_tokens (
  id         uuid primary key default gen_random_uuid(),
  base_id    uuid not null references public.bases(id) on delete cascade,

  -- The token acts AS this person. Not as the token.
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),

  name       text not null check (length(trim(name)) between 1 and 120),

  -- Only the hash. The plaintext is returned exactly once, by swamp_create_token,
  -- and then it exists nowhere in this database. If a user loses it they make a
  -- new one — that is the correct and only answer.
  token_hash text not null unique,

  -- The first few characters, so the UI can say WHICH token without holding it.
  prefix     text not null,

  -- Scopes NARROW the owner's role. They never widen it. A `records:write` scope
  -- on a viewer's token grants nothing at all.
  scopes     text[] not null default '{records:read}' check (
    scopes <@ array[
      'records:read', 'records:write',
      'schema:read',
      'webhooks:read', 'webhooks:write'
    ]::text[]
    and array_length(scopes, 1) >= 1
  ),

  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index api_tokens_base_idx on public.api_tokens (base_id);
create index api_tokens_user_idx on public.api_tokens (user_id);


/**
 * Mint a token. Returns the plaintext ONCE.
 *
 * SECURITY INVOKER: creating a token is an ordinary insert into `api_tokens`, and
 * RLS already says who may do it. Nothing to bypass.
 *
 * The plaintext is generated HERE rather than in TypeScript for the same reason
 * the share password is: so there is exactly one place that decides what a token
 * is made of, and so the only copy that ever leaves the database is the one in
 * this return value.
 */
create function public.swamp_create_token(
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


/**
 * Resolve a token to who it is and what it may do — RIGHT NOW.
 *
 * Every API call starts here, so the four ways a token dies (never existed,
 * revoked, expired, owner no longer a member) are checked in exactly one place.
 */
create function public.swamp_token_context(p_token text)
returns jsonb
language plpgsql
security definer
-- `extensions` is on the path because digest() lives in pgcrypto, and Supabase
-- installs pgcrypto there on some projects and into public on others. Naming both
-- costs nothing — a schema that doesn't exist is ignored — and the alternative is
-- a function that works on your laptop and raises "function digest does not
-- exist" the first time it runs anywhere else.
set search_path = public, extensions, pg_temp
as $$
declare
  v_t    public.api_tokens;
  v_role public.swamp_role;
begin
  select * into v_t
    from public.api_tokens
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');

  -- Every failure below is the same shape on purpose: a caller holding a bad
  -- token learns that it is bad, and nothing else.
  if v_t.id is null then
    raise exception 'swamp: invalid API token' using errcode = '28000';
  end if;

  if v_t.revoked_at is not null then
    raise exception 'swamp: this API token was revoked' using errcode = '28000';
  end if;

  if v_t.expires_at is not null and v_t.expires_at <= now() then
    raise exception 'swamp: this API token has expired' using errcode = '28000';
  end if;

  -- THE line. The role is read from live membership on every single call — it is
  -- not a copy taken when the token was minted. Remove someone from the base and
  -- their tokens stop working on the next request.
  v_role := public.swamp_base_role_of(v_t.base_id, v_t.user_id);

  if v_role is null then
    raise exception 'swamp: this token''s owner is no longer a member of the base'
      using errcode = '28000';
  end if;

  -- Touched at most once a minute. A write on every read would turn a read-heavy
  -- API into a write-heavy one, all of it landing on the same row.
  if v_t.last_used_at is null or v_t.last_used_at < now() - interval '1 minute' then
    update public.api_tokens set last_used_at = now() where id = v_t.id;
  end if;

  return jsonb_build_object(
    'tokenId', v_t.id,
    'baseId',  v_t.base_id,
    'userId',  v_t.user_id,
    'scopes',  to_jsonb(v_t.scopes),
    'role',    v_role
  );
end
$$;


/** Authenticate, then authorise: the scope must be granted AND the live role must
 *  reach the minimum. Both. A `records:write` scope on a viewer's token is not a
 *  write. */
create function public.swamp_api_require(
  p_token text,
  p_scope text,
  p_min   public.swamp_role
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx jsonb;
begin
  v_ctx := public.swamp_token_context(p_token);

  if not (v_ctx->'scopes' ? p_scope) then
    raise exception 'swamp: this token does not have the % scope', p_scope
      using errcode = '42501';
  end if;

  if public.swamp_role_rank((v_ctx->>'role')::public.swamp_role)
     < public.swamp_role_rank(p_min)
  then
    raise exception 'swamp: a % cannot do this', v_ctx->>'role' using errcode = '42501';
  end if;

  -- Writes made through this token are attributed to the person who owns it.
  perform set_config('swamp.actor', v_ctx->>'userId', true);

  return v_ctx;
end
$$;


/** The table, if it is in the token's base. A table in someone else's base is
 *  reported as "no such table" — the same answer as a table that doesn't exist.
 *  A different error would let a token holder enumerate table ids across the
 *  whole database. */
create function public.swamp_api_table(p_ctx jsonb, p_table_id uuid)
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

  return v_t;
end
$$;


/** The base's shape: tables and their fields. You cannot use the API without it —
 *  values are keyed by field KEY, and this is where you learn the keys. */
create function public.swamp_api_meta(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx  jsonb;
  v_base uuid;
begin
  v_ctx  := public.swamp_api_require(p_token, 'records:read', 'viewer');
  v_base := (v_ctx->>'baseId')::uuid;

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
    ), '[]'::jsonb)
  );
end
$$;


/** Read. The same query engine the app uses — same filter tree, same operators,
 *  same keyset cursor. There is no second implementation to drift. */
create function public.swamp_api_query(
  p_token    text,
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb
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

  return public.swamp_query_records(p_table_id, coalesce(p_spec, '{}'::jsonb));
end
$$;


/** One record, by id.
 *
 *  Not expressible as a filter — the query engine filters on field KEYS, and `id`
 *  is not a field. Fetching a single record is the most common API call there is,
 *  so it gets its own door rather than a special case bolted into the filter
 *  compiler, where it would have to be re-secured. */
create function public.swamp_api_get(
  p_token     text,
  p_table_id  uuid,
  p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx      jsonb;
  v_cat      jsonb;
  v_key      text;
  v_type     text;
  v_computed text[] := '{}';
  v_compsel  text;
  v_sql      text;
  v_rec      jsonb;
begin
  v_ctx := public.swamp_api_require(p_token, 'records:read', 'viewer');
  perform public.swamp_api_table(v_ctx, p_table_id);

  -- Built from the SAME field catalog the list endpoint uses, so a computed field
  -- — rollup, lookup, formula, URL button — is present here exactly as it is
  -- there. Fetching a record one way and a page another way is how "the total is
  -- missing but only when you open the record" happens.
  v_cat := public.swamp_field_catalog(p_table_id, null);

  for v_key, v_type in select key, value->>'type' from jsonb_each(v_cat)
  loop
    if v_type in ('link', 'lookup', 'rollup', 'count', 'formula',
                  'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy')
    then
      v_computed := v_computed || format('%L, to_jsonb(%s)', v_key, v_cat->v_key->>'expr');
    end if;
  end loop;

  v_compsel := case
    when array_length(v_computed, 1) is null then 'r.data'
    else format('(r.data || jsonb_build_object(%s))', array_to_string(v_computed, ', '))
  end;

  v_sql := format($q$
    select jsonb_build_object(
             'id',        r.id,
             'data',      %s,
             'createdAt', r.created_at,
             'updatedAt', r.updated_at
           )
      from public.records r
     where r.id = %L::uuid
       and r.table_id = %L::uuid
       and r.deleted_at is null
  $q$, v_compsel, p_record_id, p_table_id);

  execute v_sql into v_rec;

  if v_rec is null then
    raise exception 'swamp: no such record' using errcode = '42P01';
  end if;

  return v_rec;
end
$$;


create function public.swamp_api_count(
  p_token    text,
  p_table_id uuid,
  p_spec     jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx jsonb;
begin
  v_ctx := public.swamp_api_require(p_token, 'records:read', 'viewer');
  perform public.swamp_api_table(v_ctx, p_table_id);

  return public.swamp_count_records(p_table_id, coalesce(p_spec, '{}'::jsonb));
end
$$;


/** The keys a client may write on this table. Computed and auto fields are not
 *  on it — and this list is built in SQL, not taken from the caller. */
create function public.swamp_writable_keys(p_table_id uuid)
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


/** Keep only the keys that are writable. Anything else is dropped silently —
 *  a client echoing back a record it just read must not 400 because the payload
 *  contained a rollup. */
create function public.swamp_pick_writable(p_table_id uuid, p_values jsonb)
returns jsonb
language plpgsql stable
as $$
declare
  v_allowed text[] := public.swamp_writable_keys(p_table_id);
  v_out     jsonb  := '{}'::jsonb;
  v_key     text;
begin
  foreach v_key in array v_allowed loop
    if p_values ? v_key then
      v_out := v_out || jsonb_build_object(v_key, p_values->v_key);
    end if;
  end loop;

  return v_out;
end
$$;


create function public.swamp_api_insert(
  p_token    text,
  p_table_id uuid,
  p_records  jsonb   -- [{ "fields": { "fld_x": 1 } }, ...]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx   jsonb;
  v_table public.tables;
  v_order numeric;
  v_row   jsonb;
  v_ids   uuid[] := '{}';
  v_id    uuid;
begin
  v_ctx   := public.swamp_api_require(p_token, 'records:write', 'editor');
  v_table := public.swamp_api_table(v_ctx, p_table_id);

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'swamp: records must be an array';
  end if;
  if jsonb_array_length(p_records) > 1000 then
    raise exception 'swamp: at most 1000 records per call';
  end if;

  select coalesce(max(sort_order), 0) into v_order
    from public.records
   where table_id = p_table_id and deleted_at is null;

  for v_row in select * from jsonb_array_elements(p_records) loop
    v_order := v_order + 1;

    insert into public.records (table_id, base_id, data, sort_order)
    values (
      p_table_id,
      v_table.base_id,
      public.swamp_pick_writable(p_table_id, coalesce(v_row->'fields', '{}'::jsonb)),
      v_order
    )
    returning id into v_id;

    v_ids := v_ids || v_id;
  end loop;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object('id', r.id, 'fields', r.data, 'createdTime', r.created_at)
             order by r.sort_order
           )
      from public.records r
     where r.id = any(v_ids)
  ), '[]'::jsonb);
end
$$;


create function public.swamp_api_patch(
  p_token    text,
  p_table_id uuid,
  p_records  jsonb   -- [{ "id": "...", "fields": { "fld_x": 1 } }, ...]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx     jsonb;
  v_row     jsonb;
  v_patches jsonb := '[]'::jsonb;
  v_ids     uuid[] := '{}';
begin
  v_ctx := public.swamp_api_require(p_token, 'records:write', 'editor');
  perform public.swamp_api_table(v_ctx, p_table_id);

  for v_row in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    v_patches := v_patches || jsonb_build_object(
      'id',     v_row->>'id',
      'values', public.swamp_pick_writable(p_table_id, coalesce(v_row->'fields', '{}'::jsonb))
    );
    v_ids := v_ids || (v_row->>'id')::uuid;
  end loop;

  -- The same merge the app uses: `data || patch`, INSIDE the update. Two writers
  -- touching different cells of the same row both survive.
  perform public.swamp_patch_records(p_table_id, v_patches);

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'fields', r.data))
      from public.records r
     where r.id = any(v_ids) and r.table_id = p_table_id and r.deleted_at is null
  ), '[]'::jsonb);
end
$$;


create function public.swamp_api_delete(
  p_token    text,
  p_table_id uuid,
  p_ids      uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx   jsonb;
  v_count integer;
begin
  v_ctx := public.swamp_api_require(p_token, 'records:write', 'editor');
  perform public.swamp_api_table(v_ctx, p_table_id);

  update public.records
     set deleted_at = now()
   where table_id = p_table_id
     and id = any(p_ids)
     and deleted_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- Webhooks
-- ════════════════════════════════════════════════════════════════════════════

create table public.webhooks (
  id         uuid primary key default gen_random_uuid(),
  base_id    uuid not null references public.bases(id) on delete cascade,

  -- NULL = every table in the base.
  table_id   uuid references public.tables(id) on delete cascade,

  name       text not null check (length(trim(name)) between 1 and 120),
  url        text not null check (url ~ '^https?://'),

  -- The receiver uses this to verify the signature. Generated here so it is never
  -- chosen by a human, which is how "secret" ends up being "secret". Two UUIDs
  -- instead of pgcrypto's gen_random_bytes — a column default runs as the inserting
  -- role, which doesn't carry the extensions schema, so gen_random_uuid (a core
  -- builtin) is the one that resolves everywhere.
  secret     text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),

  events     text[] not null default '{record.created,record.updated,record.deleted}'
             check (events <@ array[
               'record.created', 'record.updated', 'record.deleted',
               'comment.created', 'button.clicked'
             ]::text[] and array_length(events, 1) >= 1),

  -- Fire only when one of THESE fields changed. Empty = any field.
  --
  -- Without this, a webhook on a busy table fires on every keystroke-sized edit
  -- and the receiver spends its life discarding events it doesn't care about.
  field_ids  uuid[] not null default '{}',

  -- Fire only when the record matches. A filter tree — the SAME shape the view
  -- filter builder produces, compiled by the SAME compiler. "Notify me when a
  -- deal moves to Won AND is over $50k" is a filter, and we already have one.
  condition  jsonb,

  active     boolean not null default true,

  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhooks_base_idx on public.webhooks (base_id) where active;

create trigger webhooks_touch before update on public.webhooks
  for each row execute function public.swamp_touch_updated_at();


-- The call log. Append-only from the app's side: only the dispatcher updates a
-- row, and it does so with the service role.
create table public.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  webhook_id      uuid not null references public.webhooks(id) on delete cascade,
  base_id         uuid not null references public.bases(id) on delete cascade,

  event           text not null,
  payload         jsonb not null,

  status          text not null default 'pending'
                  check (status in ('pending', 'success', 'failed', 'dead')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),

  response_status int,
  response_body   text,
  error           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The dispatcher's query: what is due, oldest first.
create index webhook_deliveries_due_idx
  on public.webhook_deliveries (next_attempt_at)
  where status = 'pending';

create index webhook_deliveries_hook_idx
  on public.webhook_deliveries (webhook_id, created_at desc);

create trigger webhook_deliveries_touch before update on public.webhook_deliveries
  for each row execute function public.swamp_touch_updated_at();


/**
 * Does this record match this condition?
 *
 * Reuses `swamp_compile_filter` — the compiler that already backs every view
 * filter — so a webhook condition supports exactly the operators a filter does,
 * including relative date windows, and there is no second dialect to learn or to
 * keep in sync.
 *
 * A condition that fails to compile fires NOTHING. The other choice — fire
 * everything — means one typo in a condition turns a webhook into a firehose
 * pointed at someone else's server.
 */
create function public.swamp_record_matches(
  p_record_id uuid,
  p_table_id  uuid,
  p_condition jsonb
)
returns boolean
language plpgsql
as $$
declare
  v_cat   jsonb;
  v_where text;
  v_ok    boolean;
begin
  if p_condition is null or jsonb_typeof(p_condition) = 'null' then
    return true;
  end if;

  v_cat   := public.swamp_field_catalog(p_table_id, null);
  v_where := public.swamp_compile_filter(p_condition, v_cat);

  execute format(
    'select exists (select 1 from public.records r where r.id = %L::uuid and %s)',
    p_record_id, v_where
  ) into v_ok;

  return coalesce(v_ok, false);
exception when others then
  return false;
end
$$;


/**
 * Enqueue deliveries for a record change.
 *
 * SECURITY DEFINER: `webhook_deliveries` has no INSERT policy for anybody. The
 * only thing that writes a delivery is this trigger and `swamp_fire_button` —
 * which is what stops a client fabricating an event, and stops a user with an
 * editor role POSTing a forged payload at a receiver that trusts us.
 *
 * Note there is NO trigger on DELETE. Records are soft-deleted (an UPDATE), and
 * a real DELETE only happens when a table or base is dropped — where a webhook
 * per row would fire ten thousand deliveries at someone's server to tell them
 * about a table they just watched disappear.
 */
create function public.swamp_enqueue_webhooks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event      text;
  v_changes    jsonb := '{}'::jsonb;
  v_keys       text[] := '{}';
  v_key        text;
  v_wh         record;
  v_scope_keys text[];
begin
  if tg_op = 'INSERT' then
    v_event := 'record.created';

  elsif old.deleted_at is null and new.deleted_at is not null then
    v_event := 'record.deleted';

  else
    -- A restore reads as an update. It is one: the record is back and its values
    -- may have changed since anyone last looked.
    v_event := 'record.updated';

    for v_key in
      select k from jsonb_object_keys(old.data) k
      union
      select k from jsonb_object_keys(new.data) k
    loop
      if (old.data->v_key) is distinct from (new.data->v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', old.data->v_key, 'to', new.data->v_key)
        );
        v_keys := v_keys || v_key;
      end if;
    end loop;

    -- Nothing actually changed. A webhook that fires on a no-op write is a
    -- webhook that fires on every sync, forever.
    if array_length(v_keys, 1) is null and old.deleted_at is not distinct from new.deleted_at then
      return new;
    end if;
  end if;

  for v_wh in
    select w.*
      from public.webhooks w
     where w.base_id = new.base_id
       and w.active
       and (w.table_id is null or w.table_id = new.table_id)
       and v_event = any(w.events)
  loop
    -- Field scoping. Only meaningful on an update: a create and a delete are
    -- about the whole record, not about a field.
    if v_event = 'record.updated' and array_length(v_wh.field_ids, 1) is not null then
      select coalesce(array_agg(f.key), '{}'::text[])
        into v_scope_keys
        from public.fields f
       where f.id = any(v_wh.field_ids) and f.deleted_at is null;

      continue when not (v_keys && v_scope_keys);
    end if;

    -- Conditions are evaluated against the record as it is NOW. On a delete
    -- there is nothing meaningful to evaluate — the row is on its way out — so
    -- the condition is skipped and the delete always fires.
    if v_wh.condition is not null and v_event <> 'record.deleted' then
      continue when not public.swamp_record_matches(new.id, new.table_id, v_wh.condition);
    end if;

    insert into public.webhook_deliveries (webhook_id, base_id, event, payload)
    values (
      v_wh.id,
      new.base_id,
      v_event,
      jsonb_build_object(
        'event',     v_event,
        'baseId',    new.base_id,
        'tableId',   new.table_id,
        'recordId',  new.id,
        'record',    jsonb_build_object('id', new.id, 'fields', new.data),
        'changes',   v_changes,
        'actor',     public.swamp_actor(),
        'timestamp', now()
      )
    );
  end loop;

  return new;
end
$$;

create trigger records_webhooks
  after insert or update on public.records
  for each row execute function public.swamp_enqueue_webhooks();


create function public.swamp_enqueue_comment_webhooks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wh record;
begin
  for v_wh in
    select w.*
      from public.webhooks w
     where w.base_id = new.base_id
       and w.active
       and (w.table_id is null or w.table_id = new.table_id)
       and 'comment.created' = any(w.events)
  loop
    insert into public.webhook_deliveries (webhook_id, base_id, event, payload)
    values (
      v_wh.id, new.base_id, 'comment.created',
      jsonb_build_object(
        'event',     'comment.created',
        'baseId',    new.base_id,
        'tableId',   new.table_id,
        'recordId',  new.record_id,
        'comment',   jsonb_build_object('id', new.id, 'body', new.body),
        'actor',     new.author_id,
        'timestamp', now()
      )
    );
  end loop;

  return new;
end
$$;

create trigger comments_webhooks
  after insert on public.comments
  for each row execute function public.swamp_enqueue_comment_webhooks();


/**
 * A button that calls a webhook.
 *
 * SECURITY DEFINER because deliveries are not client-writable — but it checks
 * `swamp_can(..., 'editor')` first. A viewer looking at a shared grid does not get
 * to press a button that charges a credit card.
 */
create function public.swamp_fire_button(p_record_id uuid, p_field_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec   public.records;
  v_field public.fields;
  v_wh    public.webhooks;
  v_id    uuid;
begin
  select * into v_rec from public.records where id = p_record_id and deleted_at is null;
  if v_rec.id is null then
    raise exception 'swamp: no such record';
  end if;

  if not public.swamp_can(v_rec.base_id, 'editor') then
    raise exception 'swamp: you cannot run this button' using errcode = '42501';
  end if;

  select * into v_field
    from public.fields
   where id = p_field_id and table_id = v_rec.table_id and deleted_at is null;

  if v_field.id is null or v_field.type <> 'button' then
    raise exception 'swamp: that field is not a button';
  end if;

  if coalesce(v_field.options->>'action', 'url') <> 'webhook' then
    raise exception 'swamp: that button does not call a webhook';
  end if;

  select * into v_wh
    from public.webhooks
   where id = (v_field.options->>'webhookId')::uuid
     and base_id = v_rec.base_id
     and active;

  if v_wh.id is null then
    raise exception 'swamp: that button points at a webhook that no longer exists';
  end if;

  insert into public.webhook_deliveries (webhook_id, base_id, event, payload)
  values (
    v_wh.id, v_rec.base_id, 'button.clicked',
    jsonb_build_object(
      'event',     'button.clicked',
      'baseId',    v_rec.base_id,
      'tableId',   v_rec.table_id,
      'recordId',  v_rec.id,
      'fieldId',   v_field.id,
      'record',    jsonb_build_object('id', v_rec.id, 'fields', v_rec.data),
      'actor',     public.swamp_actor(),
      'timestamp', now()
    )
  )
  returning id into v_id;

  return v_id;
end
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- Attachments
-- ════════════════════════════════════════════════════════════════════════════
--
-- The file lives in Supabase Storage. The record holds a reference:
--
--     [{ "id": "...", "name": "quote.pdf", "size": 91234,
--        "mime": "application/pdf", "path": "<base>/<table>/<uuid>-quote.pdf" }]
--
-- and the URL is signed AT READ TIME, never stored. A stored URL is a permanent
-- public link to a private file, and it outlives every permission change you
-- make afterwards.
--
-- The path is prefixed with the base id, and that is not cosmetic: it is what the
-- storage policy reads to decide who may touch the object.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;


/** The base a storage object belongs to, from its first path segment. NULL if the
 *  path doesn't start with a uuid — which denies, because swamp_can(null) is false. */
create function public.swamp_storage_base(p_name text)
returns uuid
language sql immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

create policy "swamp attachments: members read" on storage.objects
  for select using (
    bucket_id = 'attachments'
    and public.swamp_can(public.swamp_storage_base(name), 'viewer')
  );

create policy "swamp attachments: editors write" on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and public.swamp_can(public.swamp_storage_base(name), 'editor')
  );

create policy "swamp attachments: editors delete" on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and public.swamp_can(public.swamp_storage_base(name), 'editor')
  );


-- Every file we know about, and whether anything still points at it.
--
-- Without this, deleting an attachment from a cell leaves the object in storage
-- forever: nothing refers to it, nothing can find it, and you pay for it for the
-- rest of the product's life. Orphans are marked, not deleted — a grace period,
-- because "I removed the wrong file" happens, and because a record deletion can
-- be undone.
create table public.file_references (
  id          uuid primary key default gen_random_uuid(),
  base_id     uuid not null references public.bases(id) on delete cascade,
  table_id    uuid references public.tables(id) on delete cascade,
  record_id   uuid,
  field_id    uuid references public.fields(id) on delete set null,

  path        text not null unique,
  name        text not null,
  size        bigint,
  mime        text,

  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),

  -- Set when the last record stopped pointing at it. GC collects it later.
  orphaned_at timestamptz
);

create index file_references_orphan_idx on public.file_references (orphaned_at)
  where orphaned_at is not null;


/** Every storage path referenced by the attachment fields of one record. */
create function public.swamp_attachment_paths(p_table_id uuid, p_data jsonb)
returns text[]
language plpgsql stable
as $$
declare
  v_keys  text[];
  v_key   text;
  v_paths text[] := '{}';
  v_item  jsonb;
begin
  select coalesce(array_agg(f.key), '{}'::text[])
    into v_keys
    from public.fields f
   where f.table_id = p_table_id
     and f.type = 'attachment'
     and f.deleted_at is null;

  foreach v_key in array v_keys loop
    if jsonb_typeof(p_data->v_key) = 'array' then
      for v_item in select * from jsonb_array_elements(p_data->v_key) loop
        if v_item ? 'path' then
          v_paths := v_paths || (v_item->>'path');
        end if;
      end loop;
    end if;
  end loop;

  return v_paths;
end
$$;


/** Keep file_references in step with what the records actually reference.
 *
 *  This is the difference between "we have a GC table" and "we have GC". The table
 *  is only useful if something maintains it on every write, and the only place
 *  that sees every write is a trigger. */
create function public.swamp_reconcile_files()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text[] := '{}';
  v_new text[] := '{}';
  v_p   text;
begin
  if tg_op <> 'INSERT' then
    v_old := public.swamp_attachment_paths(old.table_id, old.data);
  end if;

  -- A soft-deleted record references nothing. Its files become orphans, and the
  -- grace period is what makes an undo still work.
  if new.deleted_at is null then
    v_new := public.swamp_attachment_paths(new.table_id, new.data);
  end if;

  foreach v_p in array v_new loop
    update public.file_references
       set record_id = new.id, table_id = new.table_id, orphaned_at = null
     where path = v_p;
  end loop;

  foreach v_p in array v_old loop
    if not (v_p = any(v_new)) then
      update public.file_references set orphaned_at = now() where path = v_p;
    end if;
  end loop;

  return new;
end
$$;

create trigger records_reconcile_files
  after insert or update on public.records
  for each row execute function public.swamp_reconcile_files();


-- ════════════════════════════════════════════════════════════════════════════
-- The button field, in the query engine
-- ════════════════════════════════════════════════════════════════════════════
--
-- A button has two shapes:
--
--   { action: 'url',     label, ast }        — a formula that computes a URL
--   { action: 'webhook', label, webhookId }  — a call, made server-side
--
-- The URL kind is compiled exactly like a formula, and registered in the catalog
-- AS a formula. That is not a fudge: for the purpose of a query, a URL button IS
-- a formula — an expression over the record's other fields. The client knows it's
-- a button because `fields.type` says so; the catalog only decides how to compute
-- the value, and the answer is "the same way".
--
-- The consequence is that everything else works without being told: the value is
-- merged into `data` on the way out, and you can filter and sort by it.

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


-- ════════════════════════════════════════════════════════════════════════════
-- A one-line fix to swamp_query_records, and it is not cosmetic
-- ════════════════════════════════════════════════════════════════════════════
--
--     v_orderparts := v_orderparts || 'r.sort_order asc' || 'r.id asc';
--
-- `text[] || <untyped literal>` is AMBIGUOUS. Postgres has two candidates —
-- array_append(anycompatiblearray, anycompatible) and array_cat(anycompatiblearray,
-- anycompatiblearray) — and an `unknown` literal fits both. Which one it picks has
-- changed between major versions: on Postgres 15 it appends, and on Postgres 18 it
-- tries to parse the string as an array and raises
--
--     malformed array literal: "r.sort_order asc"
--
-- ...from inside the ORDER BY of the single hottest function in the product. Every
-- read of every table. The app works today and every integration test passes,
-- because the local stack is on 15 — and the day someone clicks "upgrade Postgres"
-- the whole thing goes dark at once, for a reason nobody will find quickly.
--
-- Caught by running the real migrations against a Postgres 18 instance. The fix is
-- a cast: `::text` makes the operand's type known, the ambiguity disappears, and it
-- resolves the same way on every version.
--
-- Everything else below is verbatim from 20260714070000_sharing.sql.
--
-- (Buttons need no change here: a URL button registers in the catalog AS a formula,
-- so the existing `v_type in (… 'formula' …)` already merges its value into `data`.)

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
  v_proj       text[] := '{}';
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

  v_orderparts := v_orderparts || 'r.sort_order asc'::text || 'r.id asc'::text;
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

  -- One pass over the catalog builds two different payload strategies:
  --
  --   v_computed — computed fields only, to MERGE into r.data (the authorised path)
  --   v_proj     — EVERY allow-listed field, to BUILD the payload from scratch
  --                (the restricted path: a public share, or a scoped API read)
  --
  -- The client can't tell a rollup from a stored column and shouldn't have to: the
  -- grid renders record.data[field.key] whatever the field is.
  for v_key, v_type in select key, value->>'type' from jsonb_each(v_fields)
  loop
    if v_type in ('link', 'lookup', 'rollup', 'count', 'formula',
                  'createdTime', 'modifiedTime', 'createdBy', 'modifiedBy')
    then
      v_computed := v_computed || format('%L, to_jsonb(%s)', v_key, v_fields->v_key->>'expr');
      v_proj     := v_proj     || format('%L, to_jsonb(%s)', v_key, v_fields->v_key->>'expr');
    else
      -- A stored scalar: its value is r.data->key.
      v_proj := v_proj || format('%L, r.data->%L', v_key, v_key);
    end if;
  end loop;

  -- THE hidden-column fix.
  --
  -- When p_only is set, the payload is BUILT from the allow-list — not taken from
  -- r.data. Returning r.data wholesale leaked every hidden scalar column: the
  -- catalog would refuse to FILTER on `fld_salary`, but the row still carried it in
  -- `data`, so a shared view handed the salary straight out. Projecting to the
  -- allow-listed keys means a hidden column is absent from the output, not just
  -- unfilterable. When p_only is null (an authorised, whole-base read) r.data is
  -- correct — the user may see every column; hiding is a per-view UI concern there.
  v_compsel := case
    when p_only is not null then
      coalesce('jsonb_build_object(' || array_to_string(v_proj, ', ') || ')', '''{}''::jsonb')
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


-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

alter table public.api_tokens         enable row level security;
alter table public.webhooks           enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.file_references    enable row level security;

-- A token is PERSONAL. You see your own; you never see anyone else's, not even as
-- an owner. There is nothing useful in someone else's token row (the plaintext
-- isn't there) and there is a great deal that is unpleasant about a UI that lists
-- them.
create policy "api_tokens: own" on public.api_tokens
  for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    -- You may only mint a token for a base you can actually reach. What the token
    -- can DO is decided at call time by your live role — this is just the door.
    and public.swamp_can(base_id, 'viewer')
  );

-- Webhooks are base configuration. Creator, per the role ladder.
create policy "webhooks: creator" on public.webhooks
  for all
  using (public.swamp_can(base_id, 'creator'))
  with check (public.swamp_can(base_id, 'creator'));

-- The delivery log is READ ONLY, for everyone.
--
-- No insert policy: a delivery is created by the trigger (SECURITY DEFINER) and by
-- nothing else, so a client cannot forge an event and fire it at a receiver that
-- trusts our signature.
--
-- No update policy: the dispatcher runs with the service role, which bypasses RLS.
-- That means no user, at any role, can rewrite the outcome of a call.
create policy "webhook_deliveries: creator reads" on public.webhook_deliveries
  for select using (public.swamp_can(base_id, 'creator'));

create policy "file_references: members read" on public.file_references
  for select using (public.swamp_can(base_id, 'viewer'));

create policy "file_references: editors write" on public.file_references
  for insert with check (public.swamp_can(base_id, 'editor'));


-- ════════════════════════════════════════════════════════════════════════════
-- Grants — and closing a door that has been open since Phase 1a
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every migration so far ended with
--
--     grant all on all tables in schema public to anon, authenticated, service_role;
--
-- which is Supabase's convention, and which means the ONLY thing standing between
-- an anonymous request and every row in the database is RLS. That is by design and
-- it does hold — every policy requires auth.uid(), and anon has none.
--
-- But it makes RLS load-bearing in a place it doesn't have to be. One table added
-- without a policy, one `using (true)` written in a hurry, and anon reads it. The
-- sharing migration's own comment claims "anon has no usable grant on records";
-- that claim was aspirational.
--
-- So: anon loses table access entirely. It keeps EXECUTE on exactly the functions
-- that are designed to be reached without a session — the four share functions,
-- which take a share id, and the API functions, which take a token. Both check
-- before they act. Defence in depth, restored.

revoke all on all tables   in schema public from anon;
revoke all on all routines in schema public from anon;

grant all on all tables    in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant all on all routines  in schema public to authenticated, service_role;

-- Public, by share id.
grant execute on function public.swamp_shared_meta(text, text)            to anon;
grant execute on function public.swamp_shared_records(text, text, jsonb)  to anon;
grant execute on function public.swamp_submit_form(text, text, jsonb)     to anon;

-- Public, by API token. Each one authenticates the token, checks the scope, and
-- checks the owner's LIVE role before it touches anything.
grant execute on function public.swamp_api_meta(text)                 to anon;
grant execute on function public.swamp_api_query(text, uuid, jsonb)   to anon;
grant execute on function public.swamp_api_get(text, uuid, uuid)      to anon;
grant execute on function public.swamp_api_count(text, uuid, jsonb)   to anon;
grant execute on function public.swamp_api_insert(text, uuid, jsonb)  to anon;
grant execute on function public.swamp_api_patch(text, uuid, jsonb)   to anon;
grant execute on function public.swamp_api_delete(text, uuid, uuid[]) to anon;

-- Not reachable without a token, ever: these are the internals the API functions
-- are built out of, and a caller who could reach them directly could skip the
-- checks that the API functions exist to perform.
revoke all on function public.swamp_token_context(text)                     from anon;
revoke all on function public.swamp_api_require(text, text, public.swamp_role) from anon;
revoke all on function public.swamp_api_table(jsonb, uuid)                  from anon;
