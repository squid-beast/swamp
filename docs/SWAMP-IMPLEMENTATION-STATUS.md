# SWAMP — implementation status & what's left

A file-level, honest map of what is built, what is partial, and what is missing —
plus answers to the specific things you asked: the **503**, **MCP**, and **why you
can't edit templates**. Built by reading the codebase, not from memory.

> **§6's 503 diagnosis was wrong and is retracted** (2026-07-16). The site was never
> down. It was reasoned from code that was never run, and believed for months because
> nothing here could be checked in one command. `/api/health` now exists so that this
> document is never again the best available evidence about production.

Legend: ✅ done · ⚠️ partial / not wired to UI · ❌ not built.

---

## 0. Executive summary

The **engine and record-level product are close to complete.** Full CRUD exists for
records, fields, views, comments, tokens, webhooks, and members, behind a clean
three-tier API (session app API, public token API `/api/v1`, anon share API). Five
views, links/lookups/rollups/formulas, import/export, forms, realtime, and the new
templates all work.

The gaps are concentrated in **object management and admin UX**: there is **no API
route to rename or delete a table or base** (the data-layer functions exist but
aren't exposed), no group-by, no notification-style automations, no MCP, and no
in-app template editing.

> **Correction:** an earlier version of this summary claimed the site was 503ing on a
> deploy-config issue. **It was not, and never was** — `www.swampy.app` serves 200 and
> `/app` redirects to sign-in. See §6 for what was wrong and how to check properly.

---

## 1. CRUD & API matrix

Every `app/api` route and the HTTP methods it exposes, mapped to the entity.

| Entity | Create | Read | Update | Delete | Route(s) | Status |
|---|:--:|:--:|:--:|:--:|---|:--:|
| **Records** | ✅ | ✅ | ✅ | ✅ | `tables/[id]/records` (POST/PUT/PATCH/DELETE), `records/move`, `records/restore` | ✅ |
| **Records (public API)** | ✅ | ✅ | ✅ | ✅ | `v1/tables/[tableId]/records` + `/[recordId]` | ✅ |
| **Fields** | ✅ | ✅ | ✅ | ✅ | `tables/[id]/fields` (GET/POST/PATCH), `fields/[id]` (PATCH/DELETE), `fields/relational` | ✅ |
| **Views** | ✅ | ✅ | ✅ | ✅ | `tables/[id]/views`, `views/[id]`, `views/[id]/config`, `views/[id]/share` | ✅ |
| **Links (edges)** | ✅ | ✅ | ✅ | — | `tables/[id]/records/links` | ✅ |
| **Comments** | ✅ | ✅ | ✅ | ✅ | `records/[id]/comments`, `comments/[id]` | ✅ |
| **History** | — | ✅ | — | — | `records/[id]/history` | ✅ |
| **Members / roles** | ✅ | ✅ | ✅ | ✅ | `bases/[id]/members`, `invites/[id]` | ✅ |
| **API tokens** | ✅ | ✅ | — | ✅ | `bases/[id]/tokens`, `tokens/[id]` | ✅ |
| **Webhooks** | ✅ | ✅ | ✅ | ✅ | `bases/[id]/webhooks`, `webhooks/[id]`, `/deliveries`, `/dispatch` | ✅ |
| **Attachments** | ✅ | ✅ | — | ✅(gc) | `attachments/upload`, `attachments/gc` | ✅ |
| **Import / Templates** | ✅ | — | — | — | `import`, `templates` | ✅ |
| **Export** | — | ✅ | — | — | `tables/[id]/export`, `s/[shareId]/export` | ✅ |
| **Sheets sync** | ✅ | ✅ | ✅ | — | `sheets/connect|sync|tabs`, `sync` | ✅ (needs Google cfg) |
| **Tables** | ⚠️ import/template only | ✅ | ❌ **no route** | ❌ **no route** | *(none for rename/delete)* | ⚠️ |
| **Bases** | ⚠️ template only | ✅ | ❌ **no route** | ❌ **no route** | *(none for rename/delete)* | ⚠️ |

**The one real CRUD hole:** `updateTable`, `deleteTable`, and `createBase` **exist in
the data layer** (`features/tables/schema-ops.ts`, `repo.ts`) but **no API route
calls them**, so a user cannot rename/delete a table or make/rename/delete a base
from the UI (blank base creation only exists via `/api/templates` → `blank`). Wiring
these is small — the functions and even the `rename-dialog.tsx` / `confirm-dialog.tsx`
UI already exist.

---

## 2. Feature status by area (with files)

**Auth** ✅ — email+password + Google OAuth, reset/forgot, profile gate.
`features/auth/components/*`, `app/auth/callback/route.ts`, `middleware.ts`,
`shared/supabase/{server,client,public,admin,env}.ts`.

**Workspace / base / table** ⚠️ — bootstrap workspace on signup; bases/tables via
import/template; **rename/delete not wired** (§1). `features/tables/repo.ts`,
`schema-ops.ts`, `features/navigation/app-sidebar.tsx`, `features/overview/…/overview.tsx`.

**Fields (types)** ✅ — 23 scalar types + select/status + attachment + button +
link/lookup/rollup/formula/count are creatable and rendered.
`features/tables/components/field-dialog.tsx`, `cell.tsx`, `relations.ts`,
`types.ts`. ❌ not offered: **barcode, QR, user/collaborator, created/modified-by**.

**Records / grid** ✅ — virtualized grid, keyboard nav, range select, copy/paste TSV,
fill handle, undo/redo, row reorder, column resize, context menu, expanded record.
`grid.tsx`, `use-grid.ts`, `commands.ts`, `clipboard.ts`, `expanded-record.tsx`,
`record-sidebar.tsx`.

**Views** ✅ (5) — grid, kanban, gallery, calendar, form; view CRUD + config + lock
modes + share. `kanban.tsx`, `gallery.tsx`, `calendar.tsx`, `form-builder.tsx`,
`form-runtime.tsx`, `view-menu.tsx`, `view-config.ts`. ❌ **Gantt, Map, group-by** (the
data model has `groupBy` fields; no UI). ❌ **Charts/dashboard**.

**Links / lookups / rollups / formulas** ✅ — `relations.ts`, `formula/parser.ts`,
`formula/functions.ts`, `link-cell.tsx`, `relational-fields.tsx`.

**Collaboration** ✅ — comments (+ `@mention` extraction), field-level history,
invites + 5 roles, realtime. `collaboration.ts`, `use-realtime.ts`,
`members-panel.tsx`. ❌ **notifications center / mention delivery** (mentions are
parsed but nobody's notified).

**Platform** ✅ — REST API v1 (scoped tokens, keyset pagination, filter tree),
webhooks (HMAC-signed, retried, SSRF-guarded), attachments (signed reads, GC),
button field. `rest.ts`, `rest-query.ts`, `api-tokens.ts`, `webhooks.ts`,
`webhook-crypto.ts`, `attachments.ts`.

**Onboarding** ✅ — templates (CRM w/ real links, content calendar, bug tracker,
blank), settings links in sidebar. `features/tables/templates.ts`,
`app/api/templates/route.ts`, `overview.tsx`, `app-sidebar.tsx`.

**Marketing / SEO / legal** ✅ — home/about/security/legal, JSON-LD incl. Person,
sitemap/robots/OG, cookie consent, animations. `features/marketing/*`, `shared/seo/*`,
`app/(marketing)/*`.

---

## 3. Integrations status

| Integration | Built | Connected? |
|---|:--:|---|
| **Google OAuth** | ✅ | Needs Supabase Google provider secret + redirect URLs (now working after the secret fix). |
| **Google Sheets sync** | ✅ | Dormant until `GOOGLE_CLIENT_ID/SECRET` set; `/app/connect` now linked. |
| **Resend email** (invites + auth) | ✅ | Needs domain verification + `RESEND_API_KEY`; auth emails need Supabase SMTP. |
| **Outbound webhooks** | ✅ | Works; the automation surface. |
| **Vercel Analytics** | ⚠️ | Gated behind the analytics cookie consent (`consent-analytics.tsx`). |
| **Notification actions** (Slack/Discord/Email/Teams/Twilio) | ❌ | Route via n8n/Make for now. |
| **n8n / Make / Zapier app**, **OpenAPI spec**, **MCP** | ❌ | See §6. |
| **External DB as a data source** | ❌ | Architectural — SWAMP is Supabase-only (NocoDB's headline feature). |

---

## 4. Not implemented — prioritized backlog

**P0 — object management (small, unblocks daily use)**
- Table **rename / delete** route + wire to sidebar/table header (functions exist).
- Base **create (blank, non-template) / rename / delete** route + UI (functions exist).
- Field **reorder** route (`reorderFields` exists, no route).

**P1 — high value**
- **Group-by** in the grid (model supports it).
- **Notification automation actions**: Slack + Discord + Email presets on the webhook dispatcher (you already have Resend + a hardened dispatcher).
- **Duplicate** base / table / view.
- **Base & workspace settings UI** (rename, icon/color, delete).
- **@mention notifications** + a notifications center (mentions are already parsed).
- **Bulk record delete/edit** polish.

**P2 — strategic**
- **MCP server** (§6).
- **OpenAPI/Swagger spec** from `/api/v1` (makes n8n/Make/Zapier basically free).
- **Gantt / Map views**, **Charts/dashboard**.
- **Trash / restore UI** (soft-delete exists under the hood).
- **Editable templates** (§6).
- **External DB data source** (large; deliberate non-goal today).

**Minor:** offer **barcode / QR / user** field types in `field-dialog.tsx`.

---

## 5. File & module index (the “every file” map)

**Supabase clients** — `shared/supabase/`: `server.ts` (session, RLS), `client.ts`
(browser), `public.ts` (anon, for `/api/v1`), `admin.ts` (service role — 3 cron jobs
only), `env.ts` (throws if unset).

**Data engine** — `features/tables/`:
`repo.ts` (bases/workspaces/records CRUD + query), `schema-ops.ts`
(fields/views/tables create/alter/drop), `relations.ts` (link/lookup/rollup/formula
+ `setLinks`), `rest.ts` + `rest-query.ts` (public API + query parse), `rest`/query →
Postgres `swamp_*` RPCs, `sharing.ts` (anon share), `collaboration.ts`
(comments/history/invites), `webhooks.ts` + `webhook-crypto.ts` (dispatch + HMAC/SSRF),
`attachments.ts` (signed uploads/reads/GC), `api-tokens.ts`, `commands.ts`
(undo/redo), `clipboard.ts`, `templates.ts` (starter bases), `import-service.ts` +
`engine/{import,inference}.ts`, `formula/{parser,functions}.ts`, `types.ts` (domain
model), `field-key.ts`, `validate*.ts`, `view-config.ts`, `use-{grid,records,realtime}.ts`.

**Table UI** — `features/tables/components/`: `grid.tsx`, `kanban.tsx`, `gallery.tsx`,
`calendar.tsx`, `form-{builder,runtime}.tsx`, `cell.tsx`, `expanded-record.tsx`,
`record-sidebar.tsx`, `field-dialog.tsx`, `filter-builder.tsx`, `toolbar.tsx`,
`view-menu.tsx`, `link-cell.tsx`, `relational-fields.tsx`, `attachment-cell.tsx`,
`button-cell.tsx`, `members-panel.tsx`, `tokens-panel.tsx`, `webhooks-panel.tsx`,
`import-panel.tsx`, `table-workspace.tsx`, `shared-view.tsx`.

**App shell / nav** — `features/navigation/`: `app-shell.tsx` (layout + top toggle),
`app-sidebar.tsx` (tree + settings links), `command-menu.tsx`.
`features/overview/components/overview.tsx` (home + templates).

**Sheets** — `features/sheets/`: `google/sheets.ts`, `sync-service.ts`,
`components/connect-panel.tsx`.

**Marketing** — `features/marketing/components/*` (landing, nav, footer, particle
backdrop, reveal, cookie consent + analytics, legal-page) + `shared/seo/*`.

**Shared UI** — `shared/ui/` (32 shadcn components) + `shared/components/`
(`rename-dialog`, `confirm-dialog`, `swamp-mark`, `date-field`, theme).

**Routes** — see §1. **Migrations** — 13 files in `supabase/migrations/` (init →
sheets → onboarding → workspace_schema → query_engine → record_writes → relational →
sharing → collaboration → platform → fixes).

---

## 6. Your specific questions

### Why the 503?

**RETRACTED — there was no 503, and this section was wrong in every particular.**

What is actually true, measured rather than reasoned about:

```
$ curl -sS -D- -o /dev/null https://www.swampy.app/
HTTP/2 200
$ curl -sS -D- -o /dev/null https://www.swampy.app/app
HTTP/2 307
location: /auth/sign-in
```

The site serves the real app. `/app` redirects to sign-in, which proves the middleware
runs **and** that its env vars resolve — the exact opposite of what this section
claimed. No response carries an `x-vercel-error` header.

The original text is left here, struck through by this note rather than deleted,
because the way it was wrong is worth keeping:

1. **"middleware throws on missing env vars → 5xx"** — the throw is **dead code after
   build**. `NEXT_PUBLIC_*` vars are inlined by webpack's DefinePlugin at build time,
   so a missing one fails *the build*. It cannot 503 a running deployment.
2. **"middleware runs on every route"** — its matcher is
   `["/app/:path*", "/auth/sign-in", "/auth/register"]`. Three paths, not the app.
3. **"a middleware throw = 503"** — a middleware throw on Vercel is **500**
   (`MIDDLEWARE_INVOCATION_FAILED`). **503** is the platform family
   (`DEPLOYMENT_PAUSED`, `FUNCTION_THROTTLED`) and is not code at all. A timeout
   is **504**.

This section was written from plausible reasoning about code that was never run, and
it then cost real debugging time — the failure mode it warns about is its own.

**How to actually diagnose a bad response**, in one command:

```
curl -sS -D- -o /dev/null https://www.swampy.app/
```

Read the **`x-vercel-error`** header. It names the cause outright, and it beats any
ranked list of guesses. Then hit **`/api/health`** (below) for env-var presence and
database reachability.

### Is it up? — `/api/health`

`app/api/health/route.ts` reports which env vars are **present** (never their values)
and does one round-trip to Postgres. It exists because this section is what the next
person would otherwise have had to rely on.

```
curl -sS https://www.swampy.app/api/health
```

`200` = env vars present and the database answered. `503` = the body's `checks` object
names which half failed.

### How do I make it MCP?
SWAMP already has the hard part: a clean, token-authenticated REST API (`/api/v1`).
An MCP server is a thin wrapper over it. **Recommended (small, ~1 day):** a standalone
`swamp-mcp` npm package built on `@modelcontextprotocol/sdk` exposing tools —
`list_tables`, `query_records` (filter/sort), `create_record`, `update_record`,
`delete_record`, `get_meta` — each calling `https://swampy.app/api/v1/...` with the
user's SWAMP API token. Users add it to Claude/Cursor with `npx swamp-mcp` and their
token. (Optional later: a hosted HTTP/SSE MCP endpoint at `/api/mcp`.) There is **no
MCP in the repo today** (confirmed), so this is net-new — but cheap because the API
is done.

### Why can't I edit templates?
Because the templates (**CRM, Content calendar, Bug tracker, Blank**) are **defined
in code** at `features/tables/templates.ts` — they are server-side *seed
definitions*, not editable data. Two things follow:
- The **base a template creates is fully editable** (rename fields, add rows, change
  views) like any base — that works today.
- The **template itself** can't be changed from the app. To edit a template you edit
  `templates.ts` and **redeploy**; to make templates *user-editable in the UI* you'd
  need a `templates` table (store definitions as data) + a small builder — a P2
  feature, not a bug.
- If instead you meant "I can't edit records *after* creating a base," that should
  work; if it fails it is a permissions issue, not templates. (This line used to say
  "the 503/permissions issue above" — there is no 503; see §6.)

---

## 7. The one-line verdict

The record engine is a real product; the missing pieces are **object management
routes (table/base rename+delete — P0), group-by and notification automations (P1),
and MCP/OpenAPI/editable-templates (P2)**. There is **no 503 to fix** — the site is up
(§6); that claim was this document's own error, not a bug in the product.
