-- ════════════════════════════════════════════════════════════════════════════
-- Phase 5 — collaboration.
--
--   comments      — a conversation attached to a record
--   record_audit  — who changed what, field by field
--   base_invites  — invite by email, before that person has an account
--   realtime      — someone else's edit appears without a refresh
--
-- RLS on every table, in the same statement that creates it. A table that exists
-- for even one deploy without RLS is a table that was public for one deploy — and
-- `grant all on all tables to authenticated` (Supabase's convention) means an
-- un-policied table is readable by every user in the database, not just the owner.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Comments ───────────────────────────────────────────────────────────────

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  base_id     uuid not null references public.bases(id) on delete cascade,
  table_id    uuid not null references public.tables(id) on delete cascade,
  record_id   uuid not null references public.records(id) on delete cascade,

  author_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (length(body) between 1 and 10000),

  -- The people @-mentioned in this comment. Denormalised out of the body so a
  -- notification query is an index lookup rather than a regex over every comment.
  mentions    uuid[] not null default '{}',

  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index comments_record_idx on public.comments (record_id, created_at);
create index comments_mentions_idx on public.comments using gin (mentions);

create trigger comments_touch before update on public.comments
  for each row execute function public.swamp_touch_updated_at();


-- ─── Record history ─────────────────────────────────────────────────────────
--
-- Append-only. There is no UPDATE or DELETE policy on this table, for anyone —
-- an audit log you can edit is not an audit log.
--
-- `changes` holds only what ACTUALLY changed, as { key: { from, to } }. Storing
-- the whole row before and after would be simpler and would make the history tab
-- useless: "someone changed this record" is not information. "Alice changed Status
-- from Open to Won" is.

create table public.record_audit (
  id         uuid primary key default gen_random_uuid(),
  base_id    uuid not null references public.bases(id) on delete cascade,
  table_id   uuid not null references public.tables(id) on delete cascade,
  record_id  uuid not null,   -- NOT a FK: history outlives the record it describes

  actor_id   uuid references auth.users(id) on delete set null,
  op         text not null check (op in ('create', 'update', 'delete', 'restore')),
  changes    jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index record_audit_record_idx on public.record_audit (record_id, created_at desc);
create index record_audit_table_idx on public.record_audit (table_id, created_at desc);


/**
 * Write history on every record change.
 *
 * SECURITY DEFINER because the audit table has no INSERT policy — nobody may write
 * to it directly, including the person whose action caused the row. The ONLY way a
 * history row appears is through this trigger, which is the property that makes it
 * trustworthy.
 */
create function public.swamp_audit_record()
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
    values (new.base_id, new.table_id, new.id, auth.uid(), 'create', new.data);
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.record_audit (base_id, table_id, record_id, actor_id, op, changes)
    values (old.base_id, old.table_id, old.id, auth.uid(), 'delete', old.data);
    return old;
  end if;

  -- A soft delete and its undo are their own events. Rendering them as "changed
  -- deleted_at from null to a timestamp" would be technically true and useless.
  if old.deleted_at is null and new.deleted_at is not null then
    v_op := 'delete';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_op := 'restore';
  else
    v_op := 'update';
  end if;

  if v_op = 'update' then
    -- Only the keys that actually moved. Every key in either the old or the new
    -- data, compared — so a key that was ADDED shows from: null, and one that was
    -- CLEARED shows to: null. Iterating only the new keys would miss the second.
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

    -- A no-op write (the same value typed again, a sync that changed nothing) is
    -- not history. Recording it would bury the real changes in noise.
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  else
    v_changes := '{}'::jsonb;
  end if;

  insert into public.record_audit (base_id, table_id, record_id, actor_id, op, changes)
  values (new.base_id, new.table_id, new.id, auth.uid(), v_op, v_changes);

  return new;
end
$$;

create trigger records_audit
  after insert or update or delete on public.records
  for each row execute function public.swamp_audit_record();


-- ─── Invites ────────────────────────────────────────────────────────────────
--
-- You invite an EMAIL, not a user — the person you're inviting usually doesn't
-- have an account yet, and requiring them to sign up before you can invite them is
-- backwards.

create table public.base_invites (
  id          uuid primary key default gen_random_uuid(),
  base_id     uuid not null references public.bases(id) on delete cascade,
  email       text not null,
  role        public.swamp_role not null default 'editor',

  -- The token is the invite. Long enough not to be guessable; it is the only thing
  -- standing between a stranger and your base.
  --
  -- Two UUIDs (244 bits) rather than pgcrypto's gen_random_bytes: a column default
  -- is evaluated as the INSERTing role, which has no reason to carry the extensions
  -- schema on its path — so a pgcrypto default would fail on hosted Supabase for
  -- every invite. gen_random_uuid is a core builtin and always resolves.
  token       text not null unique
                default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),

  invited_by  uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  -- One live invite per email per base. Re-inviting replaces rather than stacking.
  unique (base_id, email)
);

create index base_invites_token_idx on public.base_invites (token);


/**
 * Accept an invite.
 *
 * SECURITY DEFINER, because the invitee is not yet a member of the base and
 * therefore cannot read `base_invites` or write `base_members` — that's the whole
 * chicken-and-egg an invite exists to solve.
 *
 * The email check is what makes it safe: a stolen token is useless unless you also
 * control the address it was sent to.
 */
create function public.swamp_accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.base_invites;
  v_email  text;
begin
  if auth.uid() is null then
    raise exception 'swamp: sign in to accept an invite';
  end if;

  select * into v_invite from public.base_invites where token = p_token;

  if v_invite.id is null then
    raise exception 'swamp: that invite link is not valid';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'swamp: that invite has already been used';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- The token alone is not enough. Someone forwarding you their invite link does
  -- not get you into the base; the address has to match.
  if lower(v_email) <> lower(v_invite.email) then
    raise exception 'swamp: this invite was sent to a different email address';
  end if;

  insert into public.base_members (base_id, user_id, role)
  values (v_invite.base_id, auth.uid(), v_invite.role)
  on conflict (base_id, user_id) do update set role = excluded.role;

  update public.base_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite.id;

  return v_invite.base_id;
end
$$;


-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.comments      enable row level security;
alter table public.record_audit  enable row level security;
alter table public.base_invites  enable row level security;

-- Comments: read at viewer, write at COMMENTER.
--
-- The commenter role exists precisely for this: someone who should be able to say
-- "this looks wrong" without being able to change it.
create policy "comments: read" on public.comments
  for select using (public.swamp_can(base_id, 'viewer'));

create policy "comments: commenter writes" on public.comments
  for insert with check (
    public.swamp_can(base_id, 'commenter')
    and author_id = auth.uid()          -- you cannot post as someone else
  );

-- You may edit your OWN comment. Not anyone else's — an editable comment thread
-- where others can rewrite your words is not a comment thread.
create policy "comments: edit own" on public.comments
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- Delete your own, or be a creator cleaning up.
create policy "comments: delete own or creator" on public.comments
  for delete using (
    author_id = auth.uid() or public.swamp_can(base_id, 'creator')
  );

-- Record history: READ ONLY. For everyone.
--
-- There is deliberately no insert, update or delete policy. The trigger is
-- SECURITY DEFINER and bypasses RLS; nothing else can write here at all. An audit
-- log that its subject can edit is not an audit log.
create policy "record_audit: read" on public.record_audit
  for select using (public.swamp_can(base_id, 'viewer'));

-- Invites: a creator manages them.
create policy "base_invites: creator reads" on public.base_invites
  for select using (public.swamp_can(base_id, 'creator'));

create policy "base_invites: creator writes" on public.base_invites
  for all using (public.swamp_can(base_id, 'creator'))
  with check (
    public.swamp_can(base_id, 'creator')
    -- You cannot invite someone at a role above your own. Otherwise an editor
    -- invites themselves back as an owner from a second email address.
    and public.swamp_role_rank(role) <= public.swamp_role_rank(public.swamp_base_role(base_id))
  );


-- ─── Realtime ───────────────────────────────────────────────────────────────
--
-- Postgres broadcasts row changes; RLS still applies to the subscription, so a
-- user only receives events for records they could have read anyway.
--
-- The client must ignore its OWN events — every mutation carries a client id, and
-- a subscriber that re-applies its own edit will fight its optimistic update and
-- make the cursor jump. See use-realtime.ts.

alter publication supabase_realtime add table public.records;
alter publication supabase_realtime add table public.comments;


grant all on all routines in schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
