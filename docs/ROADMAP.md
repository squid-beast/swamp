# SWAMP — Build Roadmap

**Companion to [SPEC.md](./SPEC.md).** Read that first.

---

## Working agreement

Decided 2026-07-14. These are constraints on *how* the build runs, not what it builds.

- **SWAMP becomes one unified application: an Airtable-class workspace.** Not a workspace *plus* a task board *plus* a dataset viewer *plus* a personal CRM. One product.
- **Nothing is pushed or deployed.** Local only, until Lohith has tested every feature end to end. No `git push`, no Vercel deploy, no migrations run against a live project.
- **No seed data. Ever.** Not for tests, not for demos, not for convenience. Tests build their own fixtures and tear them down.
- **Tests ship with the code.** Every phase lands with tests. No test framework exists today — Phase 0 fixes that.
- **Follow the existing conventions.** Feature modules under `features/`, shared kernel under `shared/`, thin routes in `app/`, shadcn/Radix primitives, the dependency rules in ARCHITECTURE.md. Build it the way this repo is already built.
- **No UI design work.** Behavior and structure only — reuse the existing component vocabulary.
- **Integrations and automations are in scope**, not deferred. Google Sheets survives as the first integration.

### What survives, what goes

| Keep | Rebuild | Delete |
|---|---|---|
| `features/auth` | `features/datasets` → `features/tables` (bases → tables → fields → views → records → links) | `features/task-board` + `task_boards`/`task_columns`/`task_cards` |
| `features/navigation` (shell, sidebar, command menu) | `features/sheets` → `features/integrations/sheets`, on the new schema, off the every-minute cron | `app/api/agent/*` (all 6 routes) + `features/agent` |
| `features/overview` — **stripped to a plain workspace home** (greeting, bases, recents, quick actions) | `engine/` (import, inference, recommend) — ported, not rewritten | Stripe: the balance badge in `app-shell.tsx`, the `Money` type, `/api/agent/metrics` |
| `shared/**` — 26 shadcn primitives, supabase factories, hooks | `validate.ts` — same logic, now called **server-side on write** | `FileStore` (and the auth bypass it enables) |

---

## The shape of the problem

The audit surfaced one uncomfortable fact: **SWAMP's storage primitive is right and everything above it is wrong.**

`dataset_rows` is one Postgres row per record with a JSONB payload. That is the correct foundation and we didn't have to fight for it. But every layer above assumes *"all rows, in memory, in the browser"*:

```
store.getRows(id)                  // no args — no page, filter, sort, projection
  → page.tsx                       // server: fetch table + ALL rows
    → <Workspace rows={rows}>      // client: useState<Row[]>(rows)
      → <GridView rows={data}>     // TanStack filters/sorts in JS
        → rows.map(...)            // 5,000 unvirtualized <tr>
```

with `MAX_ROWS = 5000` as the only guardrail — **a silent truncation.** Row 5,001 doesn't exist and nothing tells you.

That whole pipe has to be replaced at once. It cannot be done incrementally, because the `StorageAdapter` signature, the route contract, the component props, and the grid's data source all encode the same wrong assumption.

**So Phase 1 is not a feature. It's a rebuild of the spine.** Nothing else can be built on the current one.

---

## Sequencing principle

Order by **what's expensive to retrofit**, not by what's visible.

- The schema re-parenting (`bases → tables`) touches every FK and every URL. **Cheapest today, when the only user is us. Most expensive after launch.**
- Undo/redo requires every mutation to go through a command object. Retrofitting it into an app that mutates state ad hoc is brutal.
- The query engine determines whether every subsequent feature is a SQL clause or a JS loop.

Meanwhile: nobody's inline-editing experience is ruined by waiting a phase for it.

---

## Status

| Phase | State |
|---|---|
| 0 — Teardown & harness | **done** — one app, auth bypass closed, Vitest + Playwright + integration harness |
| 1a — Schema | **done** — bases→tables→fields→views→records→links, RLS, 18 integration tests green |
| 1b — Query engine | **done** — filter tree → SQL, relative date windows, keyset pagination, injection-tested |
| 1c — Read path | **done** — virtualized grid, server pagination, import → tables, old model dropped |
| 1d — Driving it | **done** — toolbar (filter builder, sorts, fields, row height), field CRUD, view config persistence, expanded record, kanban, gallery, CSV export |
| 3 — Editing | **done** — command stack, keyboard nav, range select, TSV copy/paste, fill handle, undo/redo, row reorder, column resize, context menus |
| 2 — Relational core | **done** — links (symmetric), lookups, rollups, count, formulas (parser → AST → SQL) |
| 4 — Views & sharing | **done** — form view (builder + public runtime), calendar, public shared views with password, view CRUD, lock modes |
| 5 — Collaboration | **done** — comments, field-level record history, invites by email, realtime |
| 6 — Platform | **done** — REST API, scoped tokens, webhooks (conditions + retries + log), attachments, button field |

Test coverage for phases 0–6 is mapped in [tests/README.md](../tests/README.md).
The API is documented in [API.md](./API.md).

## Phase 6: a token is not a second identity

The whole platform layer rests on one line, and it is worth putting here rather
than burying it in a migration:

**An API token's effective role is recomputed from live membership on every call.**

Not stored on the token when it is minted. Recomputed. So a `records:write` token
whose owner is demoted to viewer stops writing — on the next request, not at the
next rotation — and one whose owner is removed from the base stops working
entirely. Its scopes can only *narrow* what that person may do; they can never
widen it.

Store the role on the token instead and you get the thing that actually happens to
companies: *"we removed him in March and his integration was still writing to
production in July."*

The rest follows the sharing pattern exactly: **the SECURITY DEFINER functions are
the only door.** `anon` presents a token, the function resolves it to a person,
checks the scope AND the live role, and only then touches a row. There is no
authorization logic in any route handler, because a guard written in a route
handler is a guard that can be forgotten in a route handler.

Phase 6 also **closed a door that had been open since 1a**: every migration had
ended with `grant all on all tables to anon`, which is Supabase's convention and
which made RLS the *only* thing between an anonymous request and every row in the
database. It held — every policy requires `auth.uid()`. It should not have had to.
Anon now has table access to nothing, and EXECUTE on exactly the seven functions
designed to be reached without a session.

## Public sharing: where the security actually lives

An anonymous visitor has no `auth.uid()`, so RLS has nothing to scope to. The
tempting fixes — a `using (true)` policy, or "anon may read a record if some
shared view of its table exists" — both leak.

Instead: **four SECURITY DEFINER functions are the only door.** `anon` has no
usable grant on `records`. Those functions take a *share id*, derive the table
themselves, check the password, AND the view's own filter into the query, and
**scope the query engine to the view's visible fields**.

That last one is the subtle part. Stripping hidden columns from the *result* is
not enough: a visitor could filter `salary > 100000`, read the answer off the row
count, and binary-search a value they were never shown. A blind oracle is still a
leak. So a hidden column isn't merely absent from the payload — it doesn't exist
as far as the query is concerned, and filtering on it fails with "unknown field".

`tests/integration/sharing.test.ts` is written adversarially and tests exactly
that, plus: widening the view's filter, writing to a shared grid, submitting to a
non-form, and POSTing a field the form doesn't display.

*(3 landed before 2 deliberately: a grid you can't tab through feels broken in the
first thirty seconds. A missing rollup doesn't.)*

## The Phase 2 claim, and why it holds

Links, lookups, rollups and formulas all compile into **SQL expressions in the
SELECT** — not resolved in JavaScript afterwards.

That one decision is why *"show me Companies whose total deal value > 1000, sorted
by it"* works without anybody building it. The rollup is an expression; the filter
compiler and the sort compiler already point at expressions. Nothing special
happened.

Resolve them in the app instead and every one of those is a separate, worse
implementation — you'd fetch a page, compute rollups for it, and then find you
can't filter on the result because the matching rows weren't on the page you
fetched.

## What's usable today

Import a CSV → every column typed → grid, kanban or gallery. Nested filter trees
with per-type operators and relative date windows. Multi-sort. Per-view column
visibility, order and width. Add, rename, retype and delete fields.

The grid is a spreadsheet: arrow keys, Tab (wrapping), Enter to edit, Escape to
revert, type-to-replace, shift+arrow and drag to select a range, ⌘C/⌘V as TSV that
round-trips with Excel, a fill handle that continues numeric and date series,
drag to reorder rows, drag to resize columns, right-click menus — and **⌘Z through
all of it**.

## The honest gaps

- **No relations.** No links, lookups, rollups or formulas. The `links` table and
  the field types exist; nothing populates them. This is Phase 2 and it's now the
  biggest one.
- **Filter changes are last-write-wins on the whole tree.** Fine while views
  aren't shared; wrong the moment they are.
- **Undo is per-session and client-side.** It doesn't survive a reload, and it
  doesn't know about someone else's concurrent edits. That's the normal shape for
  a grid, but it's worth naming.
- **No form or calendar view.**
- **No comments, history, invites or realtime.**

---

## Phase 0 — Teardown & harness

Cut the app down to the load-bearing walls, and put a test harness under it before a single new line of product code.

### Teardown
- [ ] **Delete `features/task-board`** + its routes (`/app/tasks`) + migration `0003_boards.sql`. A board is a kanban view over a table; once Phase 4 exists it's redundant. It goes now so the schema migration doesn't have to carry it.
- [ ] **Delete `app/api/agent/*` (6 routes) and `features/agent`.** A single-owner personal CRM with hardcoded field arrays, N+1 upserts, and a service-role key. Not product surface.
- [ ] **Remove Stripe.** The balance badge in `app-shell.tsx`, the `Money` type in `datasets/types.ts`, `/api/agent/metrics`.
- [ ] **Strip `features/overview` to a plain workspace home.** Greeting, base list, recents, quick actions. No money card, no agent metrics.
- [ ] **Delete `FileStore`. Make missing Supabase env a hard boot failure.** Today `requireAuth()` returns `null` — *allowed* — when Supabase is unconfigured, and `middleware.ts` has the same escape hatch. Boot with one missing var and every API route is open. This is the most dangerous line in the repo.
- [ ] Drop the dead type surface (`FieldMeta.sortable / filterable / groupable / searchable / unique / confidence / width`). It reads as capability that doesn't exist.
- [ ] Take the sheets cron off `* * * * *` and park the sheets feature until Phase 6 rebuilds it on the new schema.

### Harness
- [ ] **Vitest** + `@testing-library/react` — unit and component tests.
- [ ] **Playwright** — e2e against a local dev server.
- [ ] A local Supabase (`supabase start`) as the test database. **Migrations only; no seed script, no fixtures file.** Each test creates the rows it needs and cleans up after itself.
- [ ] Test-data factories that build via the real API, so tests exercise the write path rather than side-loading SQL.
- [ ] `npm test`, `npm run test:e2e`, and a typecheck gate.
- [ ] **Lock in the tests that would have caught today's bugs**, before writing the fix:
  - `requireAuth()` must reject when Supabase is unconfigured
  - a write of `"banana"` into a `currency` field must 400
  - a malformed `ViewConfig` PATCH must 400

**Exit:** one app, no dead weight, and a harness that fails on the bugs we already know about.

---

## Phase 1 — The spine *(the big one)*

> Everything here ships together. There is no partial version of this that works.

### 1a. Schema

- [ ] New migration: `workspaces`, `workspace_members`, `bases`, `base_members`, `tables`, `fields`, `views`, `view_fields`, `filters`, `sorts`, `records`, `links`. (Full DDL in SPEC §4.)
- [ ] `records.order` is **`numeric`**, not `int`. Fractional indexing — copy the midpoint logic from `task-board`, which already does this correctly.
- [ ] **Denormalize `base_id`** onto `records`, `links`, `fields`, `views`. RLS reads it directly; no per-row `EXISTS` subquery.
- [ ] Indexes: `(table_id, order) where deleted_at is null`, GIN on `data`, and lazily-created expression indexes per filtered field.
- [ ] RLS rewritten against `base_members` with the role cascade.
- [ ] **Migration script** from `datasets`/`dataset_rows` → `bases`/`tables`/`fields`/`records`. Field IDs become UUIDs; the old process-counter IDs become `field.key`.

### 1b. Query engine

This is the product. It is also the largest single piece of work.

- [ ] **Filter tree → SQL compiler.** Recursive fold over the tree into nested `and`/`or`/`not`. Comparison semantics dispatch on field type.
- [ ] **Date sub-operators.** `today`, `pastNumberOfDays(n)`, `nextWeek`, … — resolved at query time, not frozen at save time. This is what makes filters feel alive.
- [ ] **Sort compiler**, with the mandatory tiebreaker appended (`order`, then `id`). *Without this, paginated reads duplicate and skip rows under concurrent writes.* Subtle, real, and it will eat a week if you skip it.
- [ ] **Cursor pagination.** Not offset. Offset over a mutating table shows users the same row twice.
- [ ] **The not-deleted predicate lives in the builder**, not at each call site. Make it impossible to forget.
- [ ] `POST /api/tables/:id/records/query` → `{ records, pageInfo }`.
- [ ] `jsonb_set` for cell writes + an `updated_at` guard. Kill the read-modify-write race.

### 1c. Read path

- [ ] Replace `StorageAdapter` with a query interface: `query(tableId, q) → { records, cursor }`.
- [ ] Split `GET /api/datasets/[id]` into `/meta` and a paginated `/records`.
- [ ] **Virtualized grid** (`@tanstack/react-virtual`). Delete the `<table>` + `.map()`.
  - Put the cell renderer behind an interface (`render(value, field)`) so a canvas renderer can be swapped in later without touching anything above it. Don't build canvas now.
- [ ] Filters / sorts / search move from `useState` → the view config → the server.

### 1d. Views as first-class objects

- [ ] View CRUD: create, rename, duplicate, delete, reorder. Default view is undeletable.
- [ ] Per-view field visibility, order, and width (`view_fields`).
- [ ] Persisted filters and sorts per view.
- [ ] View sidebar, `?view=` in the URL.

**Exit:** a table with 500k records opens instantly, filters and sorts on the server, and the view config persists. **This is the moment SWAMP stops being a CSV viewer.**

---

## Phase 2 — Relational core

The thing that makes it a database instead of a spreadsheet.

- [ ] **`link` field type + the `links` table.** Symmetric creation (a link on A creates its mirror on B). Cardinality is a constraint, not a storage layout. *This is the most bug-prone operation in the system — write it once, test it hard.*
- [ ] **Batched link hydration.** A 50-row page × 5 link fields must be ~6 queries, not 251. Never resolve a link per row.
- [ ] **`lookup`** — traverse a link, pull a field. Recursive (lookups may target lookups); guard cycles.
- [ ] **`rollup`** — `count sum avg min max countDistinct sumDistinct avgDistinct`, compiled to a correlated subquery.
- [ ] **`formula`** — parser → AST → **Postgres expression compiler**. Store `expr` (field-ID form), `expr_raw` (human form), `ast`. *A field rename must not break a single formula.* Broken formulas render an error cell without failing the query.
  - v1 function set: arithmetic, comparison, `IF SWITCH AND OR NOT`, `CONCAT LEFT RIGHT MID LEN LOWER UPPER TRIM REPLACE`, `ABS ROUND CEILING FLOOR MIN MAX SUM AVG`, `NOW TODAY DATEADD DATEDIFF DATEFORMAT YEAR MONTH DAY`, `BLANK ISBLANK`, `RECORD_ID`.
- [ ] Rollups/lookups/formulas must be **filterable and sortable** — which they are for free, because they're already SQL expressions in the SELECT. This is the payoff for compiling instead of interpreting.
- [ ] Field CRUD in the app: add, retype, delete, reorder, edit select options. (None of this exists today.)

**Exit:** two tables can reference each other and compute across the link.

---

## Phase 3 — Editing

Now the grid becomes usable rather than merely correct.

- [ ] **Inline cell editing.** An editable twin for each of the 23 types. Today only `SelectCell` is interactive; everything else routes through the row form.
- [ ] **Keyboard navigation.** Arrows, Tab/Shift+Tab with wrap, Enter to edit / commit / move down, Escape to revert, type-to-replace, Cmd+Enter to expand, Space to toggle a checkbox, Delete to clear.
- [ ] **Range selection** (shift+click, drag) and **copy/paste as TSV** — it must round-trip with Excel and Sheets. Paste a block, write a block.
- [ ] **Fill handle**, with linear-series detection on numbers and dates.
- [ ] **Undo / redo.** Every mutation goes through a command object with `do()`/`undo()`. **Build the command layer now, not later** — retrofitting undo is brutal.
- [ ] Row reorder (drag; one UPDATE thanks to fractional order), column reorder, column resize, frozen primary column, row height.
- [ ] Inline "+" row that inherits the active filter's values.
- [ ] Context menus (cell + header).
- [ ] Footer aggregations, type-gated.
- [ ] Group-by with collapsible headers, counts, per-group aggregates, lazy children.
- [ ] **Expanded record** — build it *out of* `row-form.tsx`, which is already 80% of it. Prev/next, copy URL, duplicate, delete, unsaved-changes guard.
- [ ] Record trash + restore.

**Exit:** it feels like Airtable.

---

## Phase 4 — Views & sharing

- [ ] **Kanban.** Stacks from a single-select + an always-present "Uncategorized". Drag between stacks writes the value; drag within reorders. Live per-stack counts, collapse (persisted), rename-stack → rename-option, delete-stack → move records to Uncategorized. **Build the stack↔options reconciliation from day one** — it *will* drift, and patching it later is worse.
- [ ] **Gallery.** Cover field, card fields, expand to edit.
- [ ] **Form.** The deep one: per-field label / help / required / **conditional visibility** / **limited select options**; pre-fill links in three modes (editable, locked, hidden); heading, logo, banner, success message, redirect, submit-another; survey mode. *Skipping conditional visibility and limited options is how form builders end up feeling like toys.*
- [ ] **Calendar.** Date ranges, drag to re-date, resize to change span, a side panel of un-dated records.
- [ ] **Public shared views.** Link, optional password (bcrypt, never shown again), allow-download, embed. A public viewer can read and filter locally; nothing persists.
- [ ] **View lock modes** — collaborative / locked / personal. The permission check is two-dimensional (SPEC §7); make it a helper, not a boolean.
- [ ] Export CSV / XLSX, respecting the view's filters, sorts, and visible fields.

**Exit:** SWAMP is shareable.

---

## Phase 5 — Collaboration

- [ ] `workspace_members` / `base_members`, the five-role cascade (SPEC §9), invites.
- [ ] **Comments** on records — rich text, @mentions → notifications, edit / delete / resolve, deep-linkable.
- [ ] **Record history** — a field-level activity feed (old → new), created / deleted / restored.
- [ ] **Audit log** at the base level.
- [ ] **Realtime.** Supabase Realtime on `records`. Two things that will bite:
  - the originating client must **not double-apply its own edit** (every mutation carries a client ID; the subscriber ignores its own)
  - a link edit must **invalidate the other table's** rollup and lookup cells
- [ ] Presence (who else is on this table) — page-level, not per-cell cursors.

**Exit:** more than one person can use it.

---

## Phase 6 — Platform

- [x] **REST API** — the same query engine, exposed. `{ id, fields }` envelope, keyset cursor, strict validation. Keyed by field **key**, not name: Airtable keys by name and it is the most common way an integration breaks silently.
- [x] **API tokens**, scoped, hashed, revocable, expiring — and capped by the owner's *live* role.
- [x] **Webhooks** — events, a **condition tree** (the same filter compiler a view uses), field-scoped triggers, delivery as a background job with backoff, an HMAC signature over `timestamp.body`, an SSRF check on the resolved address, and a call log.
- [x] **`button` field** — url (from a formula, compiled to SQL like one) / webhook (fired server-side).
- [x] **Attachments** — Supabase Storage, direct upload, signed URLs at read time, `file_references` + a reconcile trigger + a GC job.
- [x] **Google Sheets, rebuilt as an integration** — done back in Phase 1: on the new schema, off the every-minute cron, and no longer append-only (it reconciles: inserts, updates *and* deletes).
- [ ] Import: Airtable, and re-import/refresh of a file source (today, importing the same CSV twice just makes a second table). **Not done.**
- [ ] Command palette scoped to base/table. **Not done.**
- [ ] Webhook actions beyond a URL (email, Slack). **Not done** — and largely unnecessary: both are a URL.

### The bug Phase 6 found in Phase 1

Running the real migration chain against **Postgres 18** (rather than the local
stack's 15) turned up a line that has been in `swamp_query_records` since 1b:

```sql
v_orderparts := v_orderparts || 'r.sort_order asc' || 'r.id asc';
```

`text[] || <untyped literal>` is **ambiguous** — `array_append` and `array_cat`
both match an `unknown` operand — and which one Postgres picks *changed between
major versions*. On 15 it appends. On 18 it tries to parse `"r.sort_order asc"`
as an array and raises `malformed array literal`, from inside the ORDER BY of the
single hottest function in the product. Every read of every table.

Nothing was broken. Every test passed. It would have gone dark the day somebody
clicked "upgrade Postgres", for a reason nobody would have found quickly. The fix
is `::text`, and it is in the Phase 6 migration.

**Worth generalising:** the migrations are now cheap to run against a throwaway
Postgres of any version (`pglite` + ~40 lines of Supabase shims). That should be
part of `verify`.

### What Phase 6 did NOT do

- The REST API returns an attachment's `path` but not a signed URL.
- `schema:read` / `webhooks:*` scopes are enforced but no endpoint uses them yet.
- No rate limiting on the API.
- No `record.restored` event — a restore arrives as `record.updated`.
- The SSRF check doesn't survive DNS rebinding (resolve, approve, `fetch` resolves again).

All five are written down in [API.md](./API.md) under "the gaps, honestly", where
the person they'll bite can actually find them.

---

## Not scheduled

Gantt (needs a whole dependency-scheduling model), Timeline, Map, dashboards/widgets, scripts, workflows, extensions, snapshots, ERD. All real, none of them are what makes or breaks this.

---

## Honest sizing

| Phase | Rough weight |
|---|---|
| 0 — Teardown & harness | days |
| **1 — The spine** | **the largest single phase. schema + query engine + read path.** |
| 2 — Relational core | large. the formula→SQL compiler is the biggest sub-piece in the project. |
| 3 — Editing | large, but parallelizable and low-risk. |
| 4 — Views & sharing | medium per view; Form is the outlier. |
| 5 — Collaboration | medium. |
| 6 — Platform | medium. |

This is a multi-month build for a small team, and there's no version of it that isn't. The good news is that Phases 0–2 are the ones with real architectural risk; 3–6 are mostly volume.

**Three things that will hurt if skipped, and that cost almost nothing today:**

1. **Re-parent the schema now** (`bases → tables`). Every month you wait multiplies the cost. Nothing is deployed and there's no real user data — this is the cheapest it will ever be.
2. **Route every mutation through a command object from the first line of Phase 1.** Undo/redo then falls out for free in Phase 3 instead of being a rewrite.
3. **Write the test with the feature, not after the phase.** There is no test framework today and ~12k lines of untested code. That number only goes up.
