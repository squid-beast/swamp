# Code & product conventions (strict)

- Match the modular monolith: put domain logic in `features/tables` (or the correct feature), not in route files. Routes stay thin.
- **Types:** `features/tables/types.ts` is canonical for field types, `OPTION_PALETTE` / `PALETTE_HEX`, webhook kinds, view config shapes. Import; do not redeclare.
- **DB access:** use shared `db()` from `@/shared/supabase/server` in session modules. `rest.ts` keeps its public-client `db()` on purpose.
- UI: shadcn primitives from `shared/ui`. No new design system. No purple-glow AI-slop aesthetics on marketing surfaces.
- Docs: only update `docs/GUIDE.md` and `docs/DEPLOY.md`. Do not create new markdown guides under `docs/` unless the user explicitly asks.
- Migrations: one concern per file; timestamp prefix; grant/revoke anon/authenticated explicitly for new functions.
- After meaningful changes: `npm run typecheck` / `npm run lint` at minimum; full `npm run verify` before claiming done.
- Scope: no unrelated refactors, no drive-by renames, no “cleanup” of files the task did not touch.
