# SWAMP — dump any data, get a UI (v1, local-first)

Any source in → schema detection → type inference → field registry → metadata → Airtable-grade UI.
No external services at runtime — everything runs locally.

**Stack:** Next.js (App Router) · shadcn/ui (Radix) · Tailwind · TanStack Table · Recharts ·
next-themes (light + dark) · Selawik (body) + Bricolage Grotesque (display).

## Run
```
npm install
npm run seed     # 3 fixture datasets (CSV x2, webhook JSON)
npm run dev      # http://localhost:3000
```

## What works
- Import: CSV / XLSX / JSON upload, plus webhook: `POST /api/datasets?name=X` with raw JSON
- Inference: email, phone, url, image, currency, percent, number, date, boolean,
  status, single/multi-select, json, long text (heuristics, confidence-scored)
- Field Registry: inferred layer + user override layer (rename/hide persist, never clobbered)
- Views: auto-recommended per dataset — Grid (TanStack data-table: column visibility,
  row selection, sticky header), Kanban, Gallery, Dashboard (auto KPIs + charts)
- Editing: click a status badge to change it, drag kanban cards between lanes,
  bulk-set status or delete selected rows, filter the grid by option values
- App shell: collapsible sidebar, breadcrumbs, ⌘K command palette, light/dark theme toggle
- Renderer sees only metadata + rows. Never the source schema.
- Tests: `npm run e2e` against a running server exercises every endpoint.

## Morning swap points (each is one file)
- `storage/store.ts` — implement `StorageAdapter` against Supabase, replace `FileStore`
- `engine/import.ts` — add `parseGoogleSheet()` once OAuth/service-account key exists
- `engine/llm.ts` (add) — Haiku pass for fields with confidence < 0.7
- Write-back, auth, share links: intentionally out of v1 scope

## Architecture
core/types.ts → engine/{import,inference,recommend}.ts → storage/store.ts →
app/api/* → components/{app-shell,Workspace,views/*,cells/Cell.tsx}

See [ARCHITECTURE.md](ARCHITECTURE.md) for what lives where and how to add a field type,
a view, or an import source — and how to swap `FileStore` for Supabase.
