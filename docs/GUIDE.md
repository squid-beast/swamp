# SWAMP — Product & usage guide

**SWAMP** is a shared spreadsheet-database for teams: import data, work in multiple views, collaborate live, share forms/links, and push or pull records over API, webhooks, and MCP.

Live product: [swampy.app](https://swampy.app)  
Stack: **Next.js 14** (App Router) on **Vercel** · **Supabase** (Postgres + Auth + Storage + Realtime)

---

## What it does

| Area | What you get |
|---|---|
| **Data** | Bases → tables → fields → records. Soft-delete + trash restore. Duplicate table (self-contained fields + rows). **Duplicate base** (whole schema — every table, field, view, filter and sort with all cross-references rewritten; records and webhooks deliberately not copied). Schema (ERD) page per base. |
| **Views** | Grid, Kanban, Gallery, Calendar, List, Timeline, Gantt, Map, Form. Filters (incl. field-to-field comparison), sorts, field visibility, row height, multi-level group-by (3 levels), row colour by select/status or by **conditional rules**. |
| **Fields** | Text, long text (plain or **rich markdown**), number, currency, percent, checkbox, date/datetime, email, URL, phone, select/status, attachment, button, auto-number, user, barcode/QR, link, lookup, rollup, formula (65+ functions), count. |
| **Collaboration** | Roles (viewer → owner), email invites, comments with emoji reactions, @mention notifications (in-app bell + email), field history, realtime edits, presence avatars. **Per-table permissions** that narrow the ladder: who may add records, who may delete/restore them, and per-field edit locks. |
| **Share** | Password-optional view links with optional **vanity slug** (a slug is guessable by construction — the random id is the security property; add a password); whole-base share pages listing already-shared views (`/s/b/…`); public forms (no account). |
| **Import / export** | CSV / Excel / JSON import with type inference; export as CSV (streams), JSON (streams) or XLSX (capped at 50k rows — SheetJS can't stream); Google Sheets (optional). |
| **API** | Strict REST `/api/v1`, forgiving ingest `/api/ingest/:tableId`, OpenAPI at `/api/v1/docs` — send your Bearer token to `/api/v1/openapi.json` and the spec becomes **per-table**, with a typed `fields` schema per field key (personalized spec is `no-store`). |
| **Workflows** | On record/comment/button events → HTTP / Slack / Discord, with conditions + field scope, HMAC signing, retries, delivery log. |
| **MCP** | AI agents call tools at `/api/v1/mcp` with the same personal access token. |

---

## How to use the product (UI)

### 1. Sign in
- Email/password or Google (if enabled in Supabase).
- First signup creates a personal workspace.

### 2. Get data in
- **Import** (`/app/import`) — CSV / XLSX / JSON; columns are typed automatically.
- **Blank / template** from the workspace home.
- **Form view** — share the link; submissions become records.
- **Ingest / API** — see [Integrations](#integrations) below.

### 3. Work a table (`/app/t/[tableId]`)
- Edit like a spreadsheet (keyboard, paste, undo).
- Toolbar: filter, sort, hide fields, row height, **Colour** (tint rows by a select/status field).
- View menu: share, **Duplicate table**, **Trash…** (restore soft-deleted rows), duplicate view.
- Presence chips show who else has the table open.

### 4. Base settings (sidebar under each base)
| Page | Path | Purpose |
|---|---|---|
| **Members** | `/app/b/[baseId]/members` | Invite people, change roles, share the base |
| **Permissions** | `/app/t/[tableId]/permissions` | Narrow the ladder per table: add / delete / per-field edit locks (view menu → Permissions…) |
| **API tokens** | `/app/b/[baseId]/api` | Mint `swamp_pat_…` tokens (scopes: `records:read`, `records:write`) |
| **Workflows** | `/app/b/[baseId]/automations` | Triggers → Slack / Discord / your URL |
| **Integrations** | `/app/b/[baseId]/integrations` | Copy-paste ingest, REST, MCP examples for this base |
| **Schema** | `/app/b/[baseId]/erd` | The tables and the links between them, as a diagram |

---

## Integrations

### Tokens
**Base → API tokens.** Create a token with `records:write` for inbound writes, `records:read` for reads. Plaintext is shown **once**. Auth header only:

```
Authorization: Bearer swamp_pat_…
```

### Ingest (leads / Zapier / forms) — forgiving
Accepts a flat JSON object; matches by field **name or key** (case-insensitive). Unknown keys are listed as `ignoredKeys`, not fatal.

```bash
curl -X POST "https://YOUR_HOST/api/ingest/TABLE_ID" \
  -H "Authorization: Bearer swamp_pat_…" \
  -H "Content-Type: application/json" \
  -d '{ "Full Name": "Ada Lovelace", "Email": "ada@example.com" }'
```

Also accepts `{ "fields": { … } }` or `{ "records": [ … ] }` (max 50). CORS enabled. Prefer a **public Form view** over putting a write token in browser JS.

**Safe retries.** Send an `Idempotency-Key` header with a unique value per submission. Replaying the same key returns the original response instead of creating a second record — protects against transport retries (timeouts, `502`s, Zapier/Make auto-retry).

**Upsert.** Add `?upsertOn=Email` (any column name or field key) so a record whose key value matches an existing one **updates** it instead of inserting a duplicate. Only sent fields change. The response then also includes `created` and `updated` counts.

```bash
curl -X POST "https://YOUR_HOST/api/ingest/TABLE_ID?upsertOn=Email" \
  -H "Authorization: Bearer swamp_pat_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6b9c1e2a-…" \
  -d '{ "Full Name": "Ada Lovelace", "Email": "ada@example.com" }'
```

### Strict REST API
- `GET /api/v1/meta` — base, tables, field **keys** (use keys in scripts; they never rename).
- `GET|POST|PATCH|DELETE /api/v1/tables/:tableId/records`
- Interactive docs: `/api/v1/docs`

```bash
curl -X POST "https://YOUR_HOST/api/v1/tables/TABLE_ID/records" \
  -H "Authorization: Bearer swamp_pat_…" \
  -H "Content-Type: application/json" \
  -d '{ "records": [{ "fields": { "fld_email": "ada@example.com" } }] }'
```

Writes are rate-limited per token. Soft delete via `DELETE ?ids=…`.

### Workflows (outbound)
**Base → Workflows.** Choose events (`record.created` / `updated` / `deleted`, `comment.created`, `button.clicked`), optional table, optional **condition**, optional **field scope** (updates only), and delivery:

| Kind | Body |
|---|---|
| **Generic** | Signed JSON `{ event, record, changes, … }` |
| **Slack** | `{ text }` (+ optional template) |
| **Discord** | `{ content }` (+ optional template) |
| **Microsoft Teams** | Adaptive Card for a Teams *Workflows* webhook (the legacy O365 connector is retired) |
| **Mattermost** | `{ text }`, Slack-compatible |
| **Email** | Sends the message via the app's email sender — no URL, just a recipient (needs `RESEND_API_KEY`) |

Every workflow has a **Test** button (sends a synthetic delivery through the real path, right now) and a sample-body preview (`GET /api/webhooks/:id/sample`).

Headers: `X-Swamp-Signature` (HMAC over `timestamp.body`), `X-Swamp-Timestamp`, `X-Swamp-Delivery` (idempotency), `X-Swamp-Event`.

**Hobby Vercel:** the dispatcher cron runs **once daily** (`0 8 * * *`). For near-real-time delivery you need Vercel Pro + a minutely schedule (see [DEPLOY.md](./DEPLOY.md)).

### MCP (AI agents)
`POST /api/v1/mcp` — JSON-RPC 2.0, same PAT.

| Tool | Scope |
|---|---|
| `list_tables`, `describe_table`, `query_records`, `count_records`, `get_record`, `aggregate` | `records:read` |
| `create_records`, `update_record`, `delete_records` | `records:write` |

Example client config:

```json
{
  "mcpServers": {
    "swamp": {
      "url": "https://YOUR_HOST/api/v1/mcp",
      "headers": { "Authorization": "Bearer swamp_pat_YOUR_TOKEN" }
    }
  }
}
```

### Zapier / Make
- **In:** HTTP POST to `/api/ingest/:tableId` with the token.
- **Out:** Workflow → Generic → Catch Hook URL.

---

## Local development

```bash
cd swamp
cp .env.example .env.local   # fill from `supabase status` after start
npx supabase start
npx supabase db reset        # replay all migrations
npm install
npm run dev                  # http://localhost:3000
```

Useful scripts: `npm run verify` (typecheck + lint + unit) · `npm run test:int` · `npm run build`.

---

## Security model (short)

- **RLS** is the boundary. App routes use the cookie client; public API uses anon + `SECURITY DEFINER` functions that re-check the token’s owner and live membership.
- Tokens can only **narrow** a person’s role; demote/remove the person and the token stops on the next call.
- Webhook destinations are SSRF-checked (no private/link-local IPs). Delivery is **at-least-once** — receivers must key on `X-Swamp-Delivery`.

---

## Known limits (honest)

- Webhooks are **daily** on Vercel Hobby.
- The Map view uses OpenStreetMap tiles: attribution is required and their usage policy discourages heavy production traffic — swap in a paid tile URL before serious volume.
- Deeper group-by levels show no server counts (only the outermost level does); conditional row colours never apply on shared views (a rule over a hidden field would leak it).
- **Permissions cover writes, not reads.** Add / delete / per-field-edit are enforced by a database trigger on every record write, so they hold for the grid, the REST API, MCP and public forms alike. There is deliberately no "hide this table/field from readers" rule: the read surface has ~15 paths that would bypass it (aggregates, single-record GET, computed values, row trash, field history, webhook payloads, table duplication, the Sheets cron on the service role), and a permission that looks enforced but isn't is worse than none. Two stated ceilings on the write side: the **service role** (the cron) is exempt, and **link/computed fields** cannot carry an edit rule because their values are not stored on the record — the database refuses such a rule rather than accepting one that does nothing.
- Attachment signed URLs are not on the token API or MCP — path only, by design. A signed URL is minted by Supabase Storage against a **session** (`auth.uid()`), and a PAT is not a session; the only way to sign one for a token holder is a service-role client in a read path, which the security rules forbid. Fetch attachments from a signed-in session instead.
- Some object admin (rename/delete base/table) may still be UI-partial depending on build — prefer sidebar / import for day-to-day use.

For deploy readiness and the Vercel checklist, see **[DEPLOY.md](./DEPLOY.md)**.
