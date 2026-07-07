-- SWAMP schema: profiles + owner-scoped datasets. Run in the Supabase SQL editor
-- (or `supabase db push`). RLS enforces per-user isolation; the app also scopes by
-- owner_id in code (defense in depth).

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  first_name  text,
  last_name   text,
  dob         date,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = id);

-- Create a profile row automatically when a user signs up (email/password or Google).
-- Pulls first/last/dob from sign-up metadata; Google fills name via full_name.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name, dob, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', split_part(new.raw_user_meta_data ->> 'full_name', ' ', 1)),
    coalesce(new.raw_user_meta_data ->> 'last_name',  nullif(regexp_replace(new.raw_user_meta_data ->> 'full_name', '^\S+\s*', ''), '')),
    (new.raw_user_meta_data ->> 'dob')::date,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── datasets (owner-scoped) ───────────────────────────────────────────────────
create table if not exists public.datasets (
  id          text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  source      jsonb not null,
  fields      jsonb not null,
  overrides   jsonb not null default '{}'::jsonb,
  views       jsonb not null default '[]'::jsonb,
  row_count   int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.datasets enable row level security;

create policy "datasets: all own" on public.datasets
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index if not exists datasets_owner_idx on public.datasets (owner_id, updated_at desc);

-- ── dataset_rows (one row per data row; scoped through the parent dataset) ─────
create table if not exists public.dataset_rows (
  dataset_id  text not null references public.datasets (id) on delete cascade,
  row_id      text not null,
  ord         int  not null default 0,   -- stable display order (text row_ids sort wrong)
  data        jsonb not null,
  primary key (dataset_id, row_id)
);

alter table public.dataset_rows enable row level security;

-- Index for the ordered, capped row fetch (avoids a full scan per page load).
create index if not exists dataset_rows_order_idx on public.dataset_rows (dataset_id, ord);

create policy "dataset_rows: all via owned dataset" on public.dataset_rows
  for all using (
    exists (select 1 from public.datasets d where d.id = dataset_id and d.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.datasets d where d.id = dataset_id and d.owner_id = auth.uid())
  );
