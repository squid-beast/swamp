-- ════════════════════════════════════════════════════════════════════════════
-- Drop the old datasets model.
--
-- `datasets` / `dataset_rows` are replaced by the bases → tables → fields →
-- views → records spine. Nothing in the app reads them any more.
--
-- This is a DESTRUCTIVE migration and it gets its own file, named for what it
-- destroys. A `drop` hiding at the bottom of an `add_feature` migration is how
-- people lose data they meant to keep.
--
-- No data is carried across. That was a deliberate call while the only user was
-- the developer (see docs/ENVIRONMENTS.md) — and it is a call with an expiry
-- date. The moment someone else's data is in there, this becomes an expand/
-- contract migration and costs weeks instead of an afternoon.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Sheet connections now point at a table ─────────────────────────────────
--
-- Also: `last_row_count` is gone. It was the high-water mark that made sync
-- APPEND-ONLY — the old code took `rows.slice(last_row_count)` and never looked
-- at anything before it. Edit a cell in the sheet and SWAMP never saw it; delete
-- a row and SWAMP kept it forever. It was a one-way import calling itself a sync,
-- and the divergence was invisible: the grid looked fine, it was just wrong.
--
-- Sync now reconciles every row, so there is no mark to keep.

alter table public.sheet_connections
  drop column if exists dataset_id,
  drop column if exists last_row_count;

alter table public.sheet_connections
  add column if not exists table_id uuid references public.tables(id) on delete cascade;

create index if not exists sheet_connections_table_idx
  on public.sheet_connections (table_id);


-- ─── The security-definer sync RPCs ─────────────────────────────────────────
--
-- These let the cron write without a service-role key by gating on a shared
-- secret — a genuinely elegant pattern, and one worth revisiting.
--
-- But they wrote to `dataset_rows`, and reconciling a sheet (insert + update +
-- soft-delete, keyed by sheet row) is real logic, not a bulk upsert. It now lives
-- in TypeScript where it can be read and tested. The cron takes a service-role
-- client instead, gated on CRON_SECRET, and it is the only route in the app that
-- touches that key.

drop function if exists public.sheets_apply_sync(text, text, jsonb, integer);
drop function if exists public.sheets_due_connections(text);
drop function if exists public.sheets_secret_ok(text);
drop table if exists public.sync_config;


-- ─── The old model ──────────────────────────────────────────────────────────

drop table if exists public.dataset_rows cascade;
drop table if exists public.datasets cascade;
