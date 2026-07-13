# Architecture

SWAMP is a schema-agnostic data workspace built on **Next.js 14 (App Router)**. It
is organized as a **modular monolith**: code lives in self-contained *feature
modules*, with a small, dependency-free *shared kernel*. Routes in `app/` stay thin
and delegate to features.

## Directory layout

```
app/                      # Routes only (thin pages, layouts, API handlers)
  (marketing)/            # /, /about, /privacy, /terms, /cookie-policy
  (auth)/auth/            # /auth/sign-in, /auth/register
  auth/callback/          # /auth/callback (OAuth + email confirm)
  (app)/app/              # authenticated shell
    page.tsx              # /app (overview)
    datasets/[id]/        # /app/datasets/[id] (dataset workspace)
    import/ connect/ tasks/ profile/
  api/                    # HTTP endpoints -> feature logic
    datasets/ sheets/ agent/ sync/

features/                 # Product capabilities (the primary unit of organization)
  datasets/               # Domain core: types, validate, engine, storage, views, cells
    types.ts              # Dataset/FieldMeta/Row/ViewConfig — the shared domain model
    validate.ts
    engine/               # import (CSV/XLSX/JSON), inference, view recommendation
    storage/              # StorageAdapter: FileStore (dev) | SupabaseStore (prod)
    components/           # Workspace, row-form, views/, cells/
  task-board/             # Standalone Trello-style boards
  sheets/                 # Google Sheets connect + sync (google/, lib/, components/)
  agent/                  # Headless AI agent API service (auth + service-role client)
  auth/                   # Sign-in/register/profile forms
  marketing/              # Landing, legal pages, site nav/footer
  overview/               # /app home (Home, Overview, money metrics)
  navigation/             # App shell: app-shell, app-sidebar, command-menu

shared/                   # Cross-feature kernel (no business logic, no feature imports)
  ui/                     # shadcn/Radix primitives + expandable-text
  lib/                    # cn(), formatting helpers
  supabase/               # client/server Supabase factories + auth guards
  hooks/                  # generic React hooks
  components/             # generic widgets (theme, confirm/rename dialog, date-field)

supabase/migrations/      # SQL schema (profiles, datasets, sheets, boards, onboarding)
```

## Dependency rules

1. `app/` → depends on `features/*` and `shared/*`. Contains no business logic.
2. `features/*` → may depend on `shared/*` and on the **domain types** in
   `@/features/datasets/types`. Features must not import another feature's internal
   components.
3. `shared/*` → depends on nothing in `features/`. Pure, reusable building blocks.

Import aliases (see `tsconfig.json`): `@/features/*`, `@/shared/*`, and `@/*` (root).

## Route map (canonical)

| Purpose | URL |
|---|---|
| Marketing | `/`, `/about`, `/privacy`, `/terms`, `/cookie-policy` |
| Sign in / Register | `/auth/sign-in`, `/auth/register` |
| OAuth callback | `/auth/callback` |
| App overview | `/app` |
| Dataset workspace | `/app/datasets/[id]` |
| Import / Connect / Tasks / Profile | `/app/import`, `/app/connect`, `/app/tasks`, `/app/profile` |
| Datasets API | `/api/datasets`, `/api/datasets/[id]`, `/api/datasets/[id]/rows` |
| Sheets API | `/api/sheets/connect`, `/api/sheets/tabs`, `/api/sheets/sync` |
| Cron sync | `/api/sync` (Vercel cron, every minute) |
| Agent API | `/api/agent/{leads,brands,content,tasks,metrics,outreach}` |

### Legacy redirects (permanent, in `next.config.mjs`)

`/d/:id → /app/datasets/:id` · `/sign-in → /auth/sign-in` ·
`/register → /auth/register` · `/app/board → /app/tasks`

## Data flow

```
source (CSV/XLSX/JSON/webhook/sheet)
  → features/datasets/engine.ingest()  (parse → infer field types → recommend views)
  → storage adapter                    (FileStore locally, SupabaseStore in prod)
  → app/(app)/app/datasets/[id]        (server page loads Dataset + Rows)
  → features/datasets Workspace        (Grid / Kanban / Gallery / Dashboard)
  → shared/ui Cell renderer            (renders each value by FieldType)
```

The UI renders **only** from `FieldMeta` + values; it never sees raw source schemas.

## Storage & auth

- `StorageAdapter` (`features/datasets/storage/store.ts`) selects `SupabaseStore` when
  Supabase env vars are present, else `FileStore` (writes to gitignored `./data`).
- Supabase Postgres enforces per-user isolation via RLS; the app also scopes by
  `owner_id` (defense in depth).
- Middleware refreshes the session and gates `/app/*`; `/auth/*` redirects signed-in
  users to `/app`. Without Supabase configured, the app runs open on the FileStore.
