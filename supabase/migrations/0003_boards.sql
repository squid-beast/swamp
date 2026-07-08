-- Standalone agile task boards (Trello-style), independent of datasets:
-- a user owns boards → columns → cards. RLS scopes everything to the owner via a
-- denormalized owner_id, and child writes additionally require the referenced
-- parent to be owned by the caller (no owner-scoped orphan rows). Run after 0002.

-- ── boards ────────────────────────────────────────────────────────────────────
create table if not exists public.task_boards (
  id          text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.task_boards enable row level security;
drop policy if exists "task_boards: all own" on public.task_boards;
create policy "task_boards: all own" on public.task_boards
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index if not exists task_boards_owner_idx on public.task_boards (owner_id, updated_at desc);

-- ── columns (lanes) ───────────────────────────────────────────────────────────
create table if not exists public.task_columns (
  id          text primary key,
  board_id    text not null references public.task_boards (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  position    double precision not null default 0,   -- float → midpoint insert, no reindex
  created_at  timestamptz not null default now()
);
alter table public.task_columns enable row level security;
drop policy if exists "task_columns: all own" on public.task_columns;
create policy "task_columns: all own" on public.task_columns
  for all using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.task_boards b where b.id = board_id and b.owner_id = auth.uid())
  );
create index if not exists task_columns_board_idx on public.task_columns (board_id, position);

-- ── cards (tasks) ─────────────────────────────────────────────────────────────
create table if not exists public.task_cards (
  id          text primary key,
  column_id   text not null references public.task_columns (id) on delete cascade,
  board_id    text not null references public.task_boards (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  description text,
  priority    text,                                   -- 'low' | 'medium' | 'high' | null
  due_date    date,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (priority is null or priority in ('low', 'medium', 'high'))
);
alter table public.task_cards enable row level security;
drop policy if exists "task_cards: all own" on public.task_cards;
create policy "task_cards: all own" on public.task_cards
  for all using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.task_boards  b where b.id = board_id  and b.owner_id = auth.uid())
    and exists (select 1 from public.task_columns c where c.id = column_id and c.owner_id = auth.uid())
  );
create index if not exists task_cards_column_idx on public.task_cards (column_id, position);
