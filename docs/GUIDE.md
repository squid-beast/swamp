# SWAMP — Product & usage guide

**SWAMP** is a shared spreadsheet-database for teams: import data, work in multiple views, collaborate live, share forms/links, and push or pull records over API, webhooks, and MCP.

Live product: [swampy.app](https://swampy.app)  
Stack: **Next.js 14** (App Router) on **Vercel** · **Supabase** (Postgres + Auth + Storage + Realtime)

---

## What it does

| Area | What you get |
|---|---|
| **Data** | Bases → tables → fields → records. Soft-delete + trash restore. Duplicate table (self-contained fields + rows). |
| **Views** | Grid, Kanban, Gallery, Calendar, Form. Filters, sorts, field visibility, row height, row colour by select/status. |
| **Fields** | Text, long text, number, currency, percent, checkbox, date/datetime, email, URL, phone, select/status, attachment, button, auto-number, user, barcode/QR, link, lookup, rollup, formula, count. |
| **Collaboration** | Roles (viewer → owner), email invites, comments, field history, realtime edits, presence avatars. |
| **Share** | Password-optional view links; public forms (no account). |
| **Import / export** | CSV / Excel / JSON import with type inference; export; Google Sheets (optional). |
| **API** | Strict REST `/api/v1`, forgiving ingest `/api/ingest/:tableId`, OpenAPI at `/api/v1/docs`. |
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
| **Members** | `/app/b/[baseId]/members` | Invite people, change roles |
| **API tokens** | `/app/b/[baseId]/api` | Mint `swamp_pat_…` tokens (scopes: `records:read`, `records:write`) |
| **Workflows** | `/app/b/[baseId]/automations` | Triggers → Slack / Discord / your URL |
| **Integrations** | `/app/b/[baseId]/integrations` | Copy-paste ingest, REST, MCP examples for this base |

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

Headers: `X-Swamp-Signature` (HMAC over `timestamp.body`), `X-Swamp-Timestamp`, `X-Swamp-Delivery` (idempotency), `X-Swamp-Event`.

**Hobby Vercel:** the dispatcher cron runs **once daily** (`0 8 * * *`). For near-real-time delivery you need Vercel Pro + a minutely schedule (see [DEPLOY.md](./DEPLOY.md)).

### MCP (AI agents)
`POST /api/v1/mcp` — JSON-RPC 2.0, same PAT.

| Tool | Scope |
|---|---|
| `list_tables`, `describe_table`, `query_records`, `count_records`, `get_record` | `records:read` |
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
- No native “email” workflow action (use Slack/Discord/HTTP or Resend yourself).
- Attachment signed URLs are not yet on the public REST API (path only).
- Some object admin (rename/delete base/table) may still be UI-partial depending on build — prefer sidebar / import for day-to-day use.

For deploy readiness and the Vercel checklist, see **[DEPLOY.md](./DEPLOY.md)**.
