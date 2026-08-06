-- Notifications, @mention delivery and comment reactions.
--
-- ── Delivery is Supabase Realtime, not polling ──
--
-- The notifications table joins the `supabase_realtime` publication; the bell
-- subscribes with the same RLS-scoped pattern the grid already uses
-- (use-realtime.ts), so a user only ever receives their OWN rows. No cron (the
-- daily fan-out would deliver mentions tomorrow), no poll interval to tune.
--
-- ── Write discipline ──
--
-- `notifications` has NO insert/delete policy for anyone — the only writer is
-- the SECURITY DEFINER trigger, exactly like record_audit and
-- webhook_deliveries. A client cannot forge a notification. Users may UPDATE
-- their own rows, but only the read receipt: a trigger pins every other column.

-- ─── Notifications ──────────────────────────────────────────────────────────

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  base_id    uuid not null references public.bases(id) on delete cascade,
  type       text not null check (type in ('mention')),
  -- What the bell renders: { commentId, recordId, tableId, actorId, snippet }.
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

-- Mark-read only. The column guard below keeps the UPDATE surface to read_at.
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid());

create or replace function public.swamp_notifications_guard()
returns trigger
language plpgsql
as $$
begin
  -- The UPDATE policy admits the row; this pins every column except read_at.
  if new.id         is distinct from old.id
     or new.user_id    is distinct from old.user_id
     or new.base_id    is distinct from old.base_id
     or new.type       is distinct from old.type
     or new.payload    is distinct from old.payload
     or new.created_at is distinct from old.created_at then
    raise exception 'swamp: only read_at is updatable';
  end if;
  return new;
end
$$;

create trigger notifications_guard before update on public.notifications
  for each row execute function public.swamp_notifications_guard();

-- ─── The mention trigger ────────────────────────────────────────────────────
--
-- Modelled on swamp_audit_record: SECURITY DEFINER (notifications has no insert
-- policy — the trigger IS the writer), pinned search_path. On UPDATE it
-- notifies only the NEWLY mentioned — diffing old vs new is what stops every
-- comment edit re-pinging everyone already mentioned.

create or replace function public.swamp_notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_prev uuid[] := case when tg_op = 'UPDATE' then old.mentions else '{}'::uuid[] end;
begin
  foreach v_user in array coalesce(new.mentions, '{}'::uuid[])
  loop
    -- Not previously mentioned, and not yourself — self-mentions are noise.
    if not (v_user = any(v_prev)) and v_user is distinct from auth.uid() then
      insert into public.notifications (user_id, base_id, type, payload)
      values (
        v_user,
        new.base_id,
        'mention',
        jsonb_build_object(
          'commentId', new.id,
          'recordId',  new.record_id,
          'tableId',   new.table_id,
          'actorId',   auth.uid(),
          'snippet',   left(new.body, 140)
        )
      );
    end if;
  end loop;
  return new;
end
$$;

create trigger comments_notify_mentions
  after insert or update on public.comments
  for each row execute function public.swamp_notify_mentions();

-- ─── Comment reactions ──────────────────────────────────────────────────────
--
-- One row per (comment, user, emoji): react again with the same emoji = no-op
-- by PK, remove = delete your row. Same role split as comments — read at
-- viewer, write at commenter, and only ever your own rows.

create table public.comment_reactions (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  base_id    uuid not null references public.bases(id) on delete cascade,
  emoji      text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);

create index comment_reactions_comment_idx on public.comment_reactions (comment_id);

alter table public.comment_reactions enable row level security;

create policy comment_reactions_select on public.comment_reactions
  for select using (public.swamp_can(base_id, 'viewer'));

create policy comment_reactions_insert on public.comment_reactions
  for insert with check (
    user_id = auth.uid() and public.swamp_can(base_id, 'commenter')
  );

create policy comment_reactions_delete on public.comment_reactions
  for delete using (user_id = auth.uid());

-- ─── Realtime ───────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.notifications;

-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- Trigger functions run at CREATE TRIGGER authority — no anon grant needed
-- (the anon_grants migration documents this). Strip PUBLIC anyway so the
-- anon-surface check stays clean.

revoke all on function public.swamp_notify_mentions() from public, anon;
revoke all on function public.swamp_notifications_guard() from public, anon;

-- New tables arrive with PostgREST's default anon table grants. RLS would hold
-- the line anyway, but anon has NO business holding table privileges here at
-- all — the anon-surface test enforces exactly this (defence in depth: RLS
-- should never be the only thing between the internet and a row).
revoke all on table public.notifications from anon;
revoke all on table public.comment_reactions from anon;
