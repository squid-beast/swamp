# Architecture

SWAMP is an Airtable-class data workspace built on **Next.js 14 (App Router)**. It
is organized as a **modular monolith**: code lives in self-contained *feature
modules*, with a small, dependency-free *shared kernel*. Routes in `app/` stay thin
and delegate to features.

> **This document describes the code as it stands today, mid-rebuild.**
> The target architecture is [docs/SPEC.md](./docs/SPEC.md); the sequence is
> [docs/ROADMAP.md](./docs/ROADMAP.md). Much of `features/datasets` below is
> scheduled for replacement in Phase 1 — see "Known ceilings" at the bottom.

## Directory layout

```
app/                      # Routes only (thin pages, layouts, API handlers)
  (marketing)/            # /, /about, /privacy, /terms, /cookie-policy
  (auth)/auth/            # /auth/sign-in, /auth/register
  auth/callback/          # /auth/callback (OAuth + email confirm)
  (app)/app/              # authenticated shell
    page.tsx              # /app (workspace home)
    datasets/[id]/        # /app/datasets/[id] (dataset workspace)
    import/ connect/ profile/
  api/                    # HTTP endpoints -> feature logic
    datasets/ sheets/ sync/

docs/                     # SPEC.md (the target) + ROADMAP.md (the sequence)

features/                 # Product capabilities (the primary unit of organization)
  datasets/               # Domain core: types, validate, engine, storage, views, cells
    types.ts              # Dataset/FieldMeta/Row/ViewConfig — the shared domain model
    schema.ts             # zod wire schemas for anything a client can PATCH
    validate.ts           # per-type value validation (pure; shared by UI and API)
    validate-write.ts     # server-side write validation, built on validate.ts
    engine/               # import (CSV/XLSX/JSON), inference, view recommendation
    storage/              # StorageAdapter -> SupabaseStore
    components/           # Workspace, row-form, views/, cells/
  sheets/                 # Google Sheets connect + sync (google/, lib/, components/)
  auth/                   # Sign-in/register/profile forms
  marketing/              # Landing, legal pages, site nav/footer
  overview/               # /app home
  navigation/             # App shell: app-shell, app-sidebar, command-menu

shared/                   # Cross-feature kernel (no business logic, no feature imports)
  ui/                     # shadcn/Radix primitives + expandable-text
  lib/                    # cn(), formatting helpers
  supabase/               # env (fail-fast), client/server factories, auth guards
  hooks/                  # generic React hooks
  components/             # generic widgets (theme, confirm/rename dialog, date-field)

supabase/migrations/      # SQL schema (profiles, datasets, sheets, onboarding)
tests/                    # unit/ (Vitest + Testing Library) · e2e/ (Playwright)
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
| Workspace home | `/app` |
| Dataset workspace | `/app/datasets/[id]` |
| Import / Connect / Profile | `/app/import`, `/app/connect`, `/app/profile` |
| Datasets API | `/api/datasets`, `/api/datasets/[id]`, `/api/datasets/[id]/rows` |
| Sheets API | `/api/sheets/connect`, `/api/sheets/tabs`, `/api/sheets/sync` |
| Cron sync | `/api/sync` (Vercel cron) |

### Legacy redirects (permanent, in `next.config.mjs`)

`/d/:id → /app/datasets/:id` · `/sign-in → /auth/sign-in` · `/register → /auth/register`

## Data flow

```
source (CSV/XLSX/JSON/webhook/sheet)
  → features/datasets/engine.ingest()  (parse → infer field types → recommend views)
  → SupabaseStore
  → app/(app)/app/datasets/[id]        (server page loads Dataset + Rows)
  → features/datasets Workspace        (Grid / Kanban / Gallery / Dashboard)
  → shared/ui Cell renderer            (renders each value by FieldType)
```

The UI renders **only** from `FieldMeta` + values; it never sees raw source schemas.

## Storage & auth

- `StorageAdapter` (`features/datasets/storage/store.ts`) is backed by
  `SupabaseStore` — the only implementation. Every call goes through the
  cookie-bound, RLS-scoped client. There is no service-role bypass.
- **A missing Supabase env var is a boot failure** (`shared/supabase/env.ts`), not
  a degraded "open" mode. `requireAuth()` has no bypass path.
- Supabase Postgres enforces per-user isolation via RLS; the app also scopes by
  `owner_id` (defense in depth).
- Middleware refreshes the session and gates `/app/*`; `/auth/*` redirects
  signed-in users to `/app`.
- **Writes are validated server-side** (`validate-write.ts` on rows, `schema.ts`
  on dataset config). The UI validates too, but the UI is not a boundary.

## Known ceilings (why Phase 1 exists)

These are load-bearing limits in the current design, not bugs to patch:

- **`StorageAdapter.getRows(id)` takes no arguments.** No pagination, no filter,
  no sort, no projection. Every caller loads the whole table into memory, and
  `SupabaseStore` caps it at `MAX_ROWS = 5000` with a **silent truncation**.
- **Filters, sorts, and search run in the browser**, in component state, and are
  never persisted. `ViewConfig.filters` and `.sort` exist in the types and are
  read by nothing.
- **Views and fields are JSONB blobs** on the dataset row, so neither can be
  individually addressed, permissioned, or subscribed to — and every edit
  rewrites the whole array.
- **`dataset_rows.ord` is an `int`**, so row reordering is not implementable.
- **No relations.** No links, lookups, rollups, or formulas, and nowhere to put
  them.
- **Authorization is `owner_id` only.** No roles, no members, no sharing.

All six are addressed by the schema and query engine in
[docs/ROADMAP.md](./docs/ROADMAP.md) Phase 1–2.
