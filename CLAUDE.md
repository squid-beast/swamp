# CLAUDE.md — SWAMP

You are working in **SWAMP**: a Next.js 14 (App Router) + Supabase modular monolith.
Live product: swampy.app. Docs that exist: `docs/GUIDE.md` (product/API) and `docs/DEPLOY.md` (Vercel). Do not invent or revive deleted docs.

## Absolute rules

1. **Do not invent authorization in route handlers.** Session routes use `requireAuth()`. Token/public API routes pass the bearer into SECURITY DEFINER RPCs (`swamp_api_*`). RLS is the security boundary. Never add a service-role client to product write paths.
2. **Do not commit secrets.** No `.env`, keys, tokens, or `SUPABASE_SERVICE_ROLE_KEY` in git. Use `.env.example` placeholders only.
3. **Do not create parallel docs.** Only `docs/GUIDE.md` and `docs/DEPLOY.md`. Update those; never reintroduce SPEC/ROADMAP/API/FEATURES sprawl.
4. **Do not leave orphan Claude worktrees.** Prefer the main checkout. If you create a worktree under `.claude/worktrees/`, remove it when done. Never leave broken `gitdir` pointers.
5. **Do not expand scope.** No drive-by refactors, unrelated files, or “while I’m here” cleanups. Match existing patterns.
6. **Do not skip verification** for schema or auth-adjacent changes: `npm run verify`; with Docker up also `npx supabase db reset` and `npm run test:int` when you touch SQL/RLS/RPC.
7. **Do not amend or force-push** unless the user explicitly asks. Do not update git config. Commit only when asked.
8. **Do not build exploits, malware, or attack tooling.** Fix local vulnerabilities; never ship PoC attack payloads.

## Architecture facts (do not fight these)

- Domain: `workspace → base → table → { field, view, record }`.
- Feature code lives in `features/`; shared UI in `shared/ui` (shadcn-style); DB in `supabase/migrations/`.
- Public lead capture: forgiving `POST /api/ingest/:tableId`; strict CRUD under `/api/v1/...`; MCP at `POST /api/v1/mcp`.
- Workflows = webhooks with conditions/field scope + kinds `generic|slack|discord`. Dispatcher is cron (`/api/webhooks/dispatch`) — **daily on Vercel Hobby**.
- Soft delete records; restore via trash APIs. Duplicate table skips relational/computed fields by design.

## How to change things

| Change | Do this |
|---|---|
| Schema | New timestamped migration under `supabase/migrations/`. Prefer `create or replace`, explicit `revoke`/`grant`. Never hand-edit prod. |
| Types | Update `features/tables/types.ts` as source of truth (palette, webhook kinds, ViewConfig, etc.). |
| UI | Reuse shadcn components in `shared/ui`. Match existing table/toolbar density and copy tone. |
| API | Session: `requireAuth`. Token: `bearer` + rest helpers. CORS via `features/tables/cors`. Rate-limit writes. |
| Tests | Unit for pure logic; integration for RLS/RPC. Prefer extending existing harness over new frameworks. |

## Forbidden shortcuts

- No `any` to silence TypeScript; no empty `catch {}`.
- No second colour palette / `db()` wrapper / duplicated domain types — share from `types.ts` / `shared/supabase/server`.
- No webhook URL in the browser for button fields; fire server-side.
- No storing signed attachment URLs permanently.
- No putting PATs in query strings in examples meant for browsers (ingest `?token=` is URL-tool only; prefer Bearer).

## When unsure

Read `docs/GUIDE.md` and the nearest existing feature file. Prefer the smallest change that matches production patterns already in the repo.
