-- Google Sheets pull: per-user connections + stored Google refresh token, plus
-- token-gated security-definer functions for the background cron (which has no
-- user session and must not use a service-role key). Run after 0001_init.sql.

-- ── stored Google offline credential (for the poller to read the sheet later) ──
create table if not exists public.google_credentials (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);
alter table public.google_credentials enable row level security;
create policy "google_credentials: own" on public.google_credentials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── a sheet ↔ dataset connection ──
create table if not exists public.sheet_connections (
  id             text primary key,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  dataset_id     text not null references public.datasets (id) on delete cascade,
  spreadsheet_id text not null,
  sheet_title    text not null,
  last_row_count int  not null default 0,   -- data rows already ingested (excludes header)
  last_synced_at timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.sheet_connections enable row level security;
create policy "sheet_connections: own" on public.sheet_connections
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index if not exists sheet_connections_owner_idx on public.sheet_connections (owner_id);

-- ── live updates: let the browser subscribe to row inserts ──
-- (Realtime broadcasts respect RLS, so users only receive their own dataset rows.)
alter publication supabase_realtime add table public.dataset_rows;

-- ── cron trust: a single secret the poller presents; readable only by the
--    security-definer functions below (RLS on, no policies → no anon/user access) ──
create table if not exists public.sync_config (
  id     int primary key default 1,
  secret text not null,
  check (id = 1)
);
alter table public.sync_config enable row level security;
-- Set your secret here (must equal the app's SYNC_JOB_SECRET env var):
--   insert into public.sync_config (id, secret) values (1, 'CHANGE-ME') on conflict (id) do update set secret = excluded.secret;

create or replace function public.sheets_secret_ok(p_secret text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.sync_config where id = 1 and secret = p_secret);
$$;

-- Connections the cron should poll, with the owner's refresh token joined in.
create or replace function public.sheets_due_connections(p_secret text)
returns table (
  connection_id  text,
  owner_id       uuid,
  dataset_id     text,
  spreadsheet_id text,
  sheet_title    text,
  last_row_count int,
  refresh_token  text,
  fields         jsonb
) language plpgsql security definer set search_path = public as $$
begin
  if not public.sheets_secret_ok(p_secret) then
    raise exception 'forbidden';
  end if;
  return query
    select c.id, c.owner_id, c.dataset_id, c.spreadsheet_id, c.sheet_title,
           c.last_row_count, g.refresh_token, d.fields
    from public.sheet_connections c
    join public.google_credentials g on g.user_id = c.owner_id
    join public.datasets d on d.id = c.dataset_id;
end;
$$;

-- Append newly-fetched rows for one connection, bump counts + timestamps. The
-- rows arg is a jsonb array of { row_id, ord, data }.
create or replace function public.sheets_apply_sync(
  p_secret text, p_connection_id text, p_rows jsonb, p_total_rows int
) returns void language plpgsql security definer set search_path = public as $$
declare v_dataset text;
begin
  if not public.sheets_secret_ok(p_secret) then
    raise exception 'forbidden';
  end if;
  select dataset_id into v_dataset from public.sheet_connections where id = p_connection_id;
  if v_dataset is null then raise exception 'unknown connection'; end if;

  insert into public.dataset_rows (dataset_id, row_id, ord, data)
  select v_dataset, e->>'row_id', (e->>'ord')::int, e->'data'
  from jsonb_array_elements(p_rows) e
  on conflict (dataset_id, row_id) do nothing;

  update public.datasets set row_count = p_total_rows, updated_at = now() where id = v_dataset;
  update public.sheet_connections
    set last_row_count = p_total_rows, last_synced_at = now()
    where id = p_connection_id;
end;
$$;
