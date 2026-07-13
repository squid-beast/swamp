# SWAMP

A schema-agnostic data workspace. Dump in a CSV, Excel file, JSON payload, webhook,
or Google Sheet — SWAMP infers the field types, recommends views, and renders an
Airtable-style Grid / Kanban / Gallery / Dashboard. Also ships a standalone task
board and a headless API for AI agents.

## Tech stack

- **Next.js 14** (App Router), **React 18**, **TypeScript** (strict)
- **Tailwind CSS** + **shadcn/ui** (Radix)
- **TanStack Table**, **Recharts**
- **Supabase** (Auth, Postgres, RLS, Realtime)
- **Vercel** (hosting + cron)

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase / Google keys (optional for local)
npm run dev                        # http://localhost:3000
```

Without Supabase env vars, the app runs **open** on a local file-based store
(`./data`, gitignored) — handy for local development and testing.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (type-checked) |
| `npm run start` | Serve the production build |
| `npm run e2e` | Run the API pipeline test (needs a running server): `node scripts/e2e.mjs` |

## Project structure

Organized by **feature module** under `features/`, with a shared kernel under
`shared/`, and thin routes under `app/`. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the full layout, dependency rules, and route map.

```
app/        # routes (pages, layouts, API handlers) — thin
features/   # datasets, task-board, sheets, agent, auth, marketing, overview, navigation
shared/     # ui, lib, supabase, hooks, components
supabase/   # SQL migrations
```

## Environment

Set in `.env.local` (see `.env.local.example`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `…_PUBLISHABLE_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (agent/cron writes)
- `AGENT_API_SECRET`, `AGENT_OWNER_EMAIL` (headless agent API)
- `SYNC_JOB_SECRET` (Google Sheets cron)
- Google OAuth keys for Sheets sync

## Deployment

Deploys to **Vercel**. `vercel.json` registers the `/api/sync` cron (every minute)
for Google Sheets polling. Apply `supabase/migrations/*.sql` to your Supabase project.
