# NocoDB (`nocodb-develop`) — end-to-end analysis

A read-only walkthrough of the `nocodb-develop` repository as it sits on disk
(`develop` branch, backend package version **0.301.3**). Nothing in the repo was
modified. Facts below are pulled from the actual manifests, source, license, and
config — not from memory.

> **Headline correction:** this NocoDB is **not AGPL**. As of the license file
> dated **January 29, 2026**, it is under the **Sustainable Use License v1.0** — a
> "fair-code" / source-available license with commercial restrictions (see §7).
> That is stricter for commercial reuse than AGPL, and it strengthens the case for
> SWAMP staying clean-room (no NocoDB code copied).

---

## 1. What the application does

NocoDB turns a database into a **no-code spreadsheet + API platform** — "the
fastest and easiest way to build databases online" (its own tagline). You point it
at a SQL database (or let it manage its own), and it gives you:

- An **Airtable-style UI** over your tables: Grid, Gallery, Kanban, Calendar, Form,
  and Gantt views; rich field types; links/lookups/rollups/formulas; filters,
  sorts, grouping; row-level detail; comments; and role-based sharing.
- **Auto-generated REST APIs** (and a Swagger/OpenAPI schema) plus SDK clients for
  every table you expose.
- **Webhooks & automations** that fire on record changes and deliver to URLs or
  notification providers (Slack, Teams, Discord, Twilio, etc.).
- **Data sources**: unlike a plain app DB, NocoDB can connect to an *existing*
  external database (MySQL/Postgres/etc.) and edit it in place — this is its
  defining capability. Metadata about your setup lives in a separate "meta" DB.
- Newer additions in this build: an **integrations framework** (AI, Auth/SSO, and
  data **Sync** connectors) and a **built-in MCP server**
  (`packages/nocodb/src/mcp/`) so agents can talk to it.

It ships as a self-hostable server (Docker image, binary, or from source) and also
powers NocoDB's hosted Cloud (Enterprise features are gated by a license key).

---

## 2. Technology stack

**Monorepo** managed with **pnpm workspaces + Lerna** (`pnpm-workspace.yaml`,
`lerna.json`). Node **>= 22** required.

**Backend — `packages/nocodb` (v0.301.3):**
- **NestJS** application framework (`@nestjs/core`).
- **Knex** query builder as the DB abstraction; supports **SQLite3** (default meta
  store), **PostgreSQL** (`pg`), and **MySQL** (`mysql2`) — plus other SQL engines
  as data sources.
- **Auth:** `jsonwebtoken` + `passport` (JWT access tokens + refresh tokens).
- **Queue / cache:** `bull` + `ioredis` (Redis, optional — falls back without it).
- **Realtime:** `socket.io`.
- **Storage:** `@aws-sdk/client-s3` + a large set of S3-compatible plugins.
- **Email:** `nodemailer` (+ SES / SMTP / MailerSend plugins).
- **Uploads:** `multer`. **Import/parse:** `xlsx` (SheetJS), `papaparse` (CSV).
- **Templating:** `ejs`. Utilities: `nanoid`, `dayjs`, `axios`.
- ~**167** runtime dependencies (a large surface — see §8).

**Frontend — `packages/nc-gui`:**
- **Nuxt 3** (3.17.4) on **Vue 3**.
- **Ant Design Vue** 3.2 component library, `@vueuse/core`, `pinia` (state),
  `vuedraggable`. (Tailwind is also used for styling.)

**Other packages:**

| Package | Role |
|---|---|
| `nocodb` | NestJS backend / API / engine |
| `nc-gui` | Nuxt 3 frontend (the dashboard) |
| `nocodb-sdk`, `nocodb-sdk-v2` | TypeScript client SDKs (also used internally) |
| `nc-lib-gui` | Pre-built GUI bundle the backend serves in production |
| `nc-mail-assets` | Email template assets |
| `nc-secret-mgr` | Secret-manager CLI utility |
| `noco-integrations`, `nc-integration-scaffolder` | Integrations framework (AI / Auth / Sync) + scaffolder |

---

## 3. Architecture

**Two databases, by design:**
- **Meta DB** (`NC_DB`) — where NocoDB stores *its own* metadata (bases, tables,
  views, fields, users, ACL, tokens…). Defaults to a local SQLite file; can be
  Postgres or MySQL.
- **Data sources** (`NC_SOURCE`) — the actual data. NocoDB either creates tables in
  a source or connects to your **existing** external database and reflects its
  schema into the UI/API.

**Backend (NestJS):** modular services expose:
- The dashboard/meta APIs and the per-table **auto-generated data APIs**.
- A **Swagger/OpenAPI v3** schema (`packages/nocodb/src/schema/swagger-v3.json`).
- An **MCP** controller/service (`src/mcp/mcp.controller.ts`, `mcp.service.ts`).
- **Webhooks** as plugin-driven notifications; jobs run through **Bull** (Redis) or
  in-process.
- **ACL** and JWT/passport auth guarding everything; API tokens with scopes
  (`nc_api_tokens`, `nc_api_token_scopes`).

**Frontend (Nuxt 3 SPA/SSR):** talks to the backend over the REST APIs + socket.io,
and in production is served as the pre-built `nc-lib-gui` bundle by the backend
(`NC_GUI_DIST_PATH`).

**Integrations framework** (`noco-integrations`): a registry-based plugin system
with categories `ai`, `auth`, and `sync`, letting new connectors be added without
touching core.

---

## 4. How to run it locally

Several supported paths (from the README and scripts):

**A. Docker (quickest):**
```bash
docker run -d --name nocodb -p 8080:8080 nocodb/nocodb:latest
# then open http://localhost:8080/dashboard
```
(The README shows a fuller `docker run -d` with a mounted volume and `NC_DB` for a
Postgres/MySQL meta store.)

**B. Auto-install script:** `docker-compose/1_Auto_Upstall/` (a one-command
self-host installer); `docker-compose/examples/` has compose files.

**C. Binary:** prebuilt binaries exist "for quick testing locally" (README caveat).

**D. From source (development):**
```bash
# Node >= 22, pnpm required (preinstall enforces pnpm)
pnpm bootstrap          # builds the SDK, installs backend + gui + integrations
pnpm start:backend      # NestJS API on :8080
pnpm start:frontend     # Nuxt dev server (proxies to the backend)
```
Default dashboard: **http://localhost:8080/dashboard**. With no `NC_DB` set, it
creates a local SQLite meta store, so it runs with zero external services.

---

## 5. External services it depends on

**None are strictly required** to boot (SQLite meta + local disk + no telemetry key
works). Optional/pluggable services:

- **Databases:** PostgreSQL, MySQL/MariaDB, SQLite, and other SQL engines — as the
  meta store and/or as data sources.
- **Redis** (`NC_REDIS_*`) — for the Bull job queue and caching in multi-worker/HA
  setups.
- **Object storage (attachments)** — a broad plugin set: **S3, MinIO, Google Cloud
  Storage (GCS), Cloudflare R2, Backblaze, DigitalOcean Spaces, Scaleway, Linode,
  OVHCloud, UpCloud, Vultr, GenericS3**.
- **Email:** SMTP, **Amazon SES**, **MailerSend**.
- **Notifications (webhook targets):** **Slack, Microsoft Teams, Discord,
  Mattermost, Twilio (SMS), Twilio WhatsApp**.
- **Telemetry:** **PostHog** + `telemetry.nocodb.com` (usage analytics, **on by
  default**, opt-out via `NC_DISABLE_TELE`).
- **AI providers** via the new integrations framework (`noco-integrations/.../ai`).
- **Enterprise/Cloud:** an `NC_LICENSE_KEY` unlocks EE features; `NC_CLOUD` toggles
  hosted-mode behavior.

Key env vars seen in the backend: `NC_DB`, `NC_SOURCE`, `NC_AUTH_JWT_SECRET`,
`NC_JWT_EXPIRES_IN`, `NC_REFRESH_TOKEN_EXP_IN_DAYS`, `NC_REDIS_TYPE/TTL`,
`NC_SITE_URL`, `NC_DASHBOARD_URL`, `NC_GUI_DIST_PATH`, `NC_ATTACHMENT_FIELD_SIZE`,
`NC_DISABLE_TELE`, `NC_LICENSE_KEY`, `NC_DISABLE_PG_DATA_REFLECTION`.

---

## 6. Where branding & product-specific references exist

NocoDB branding is pervasive — a rename/white-label would be a substantial effort:

- **~2,392** occurrences of the string "NocoDB" across the frontend + backend
  source alone (plus translations, docs, and assets).
- **Logos/brand assets:** `packages/nc-gui/assets/img/brand/` (e.g.
  `nocodb-full.png`), favicons, email assets (`nc-mail-assets`).
- **Domains/URLs baked in:** `nocodb.com`, `docs.nocodb.com`, `community.nocodb.com`,
  `telemetry.nocodb.com`, the Discord/Twitter/Reddit links in the README, and
  `security@nocodb.com`.
- **Internal prefixes everywhere:** meta tables use the `nc_` prefix
  (`nc_api_tokens`, `nc_acl`, `nc_addons`, …) and code uses `xc*` identifiers —
  these are internal, not user-facing, but they thread through the schema and code.
- **Author/legal:** "NocoDB Inc" (`nocodb.com`) in every `package.json`.
- Translations for ~20+ languages under `markdown/readme/languages/` and
  `packages/nc-gui/lang/`.

---

## 7. What the license allows

**Sustainable Use License v1.0** (file dated 2026-01-29). It is **source-available,
not OSI open source.** Scope: only the `master` and `develop` branches are licensed;
**"other branches are not licensed."** Third-party components keep their own
licenses. Every first-party package (`nocodb`, `nc-gui`, `nocodb-sdk`,
`nocodb-sdk-v2`, `nc-lib-gui`) carries this same license.

**You MAY:**
- Use, copy, modify, and distribute the software **for your own internal business
  purposes**, or for **non-commercial / personal** use.
- Distribute it or give it to others **only free of charge and for non-commercial
  purposes**.
- Make derivative works, within those same limits.

**You MAY NOT:**
- Use it **commercially** beyond your own internal business use — e.g. **offering it
  (or a derivative) to others as a paid product or hosted service** is not permitted
  without a separate commercial agreement.
- **Remove or obscure** licensing/copyright notices, or misuse NocoDB trademarks.
- Rely on any branch other than `master`/`develop`.

**Other terms:** a patent grant (with a termination-on-patent-claim clause); a
notices requirement (downstream recipients must get the license; modified copies
must state they were modified); 30-day cure on violation; "as is", no warranty, no
liability.

**What this means for SWAMP:** you must **not** copy NocoDB source into SWAMP — the
Sustainable Use License would forbid the commercial use you intend. Replicating the
*idea/behaviour* is fine (ideas aren't copyrightable); copying *code* is not. SWAMP
was built clean-room with no NocoDB code, so it is unaffected — but this is exactly
why that discipline matters. *(Not legal advice — confirm with a lawyer before
relying on it.)*

---

## 8. Security & maintenance concerns

- **License/usage risk (biggest one for you):** the Sustainable Use License blocks
  commercial redistribution/hosting of NocoDB or its derivatives. Treat NocoDB as a
  reference/self-host tool, never as a codebase to lift into a product.
- **Telemetry on by default:** usage data goes to PostHog / `telemetry.nocodb.com`.
  Set `NC_DISABLE_TELE=true` for a private/self-hosted deployment.
- **JWT secret:** `NC_AUTH_JWT_SECRET` must be set to a strong, stable value in
  production. If left unset, the server derives one, which risks session
  invalidation on restart and weaker guarantees — a classic self-host footgun.
- **Powerful data-source credentials:** connecting to external databases means
  NocoDB holds credentials that can read/write your real DB. Knex parameterizes
  queries, but the blast radius of a misconfig or a leaked secret is large; lock down
  DB users and network access.
- **Large dependency & attack surface:** ~167 backend deps plus a full Nuxt
  frontend and many storage/notification plugins. More to patch and audit than a
  lean app (for contrast, SWAMP runs far fewer dependencies on managed Supabase).
- **Self-host hardening:** put it behind HTTPS, set `NC_SITE_URL`, use a real meta
  DB (Postgres) rather than the SQLite default for anything shared, and secure the
  Redis/S3 credentials.
- **Enterprise-gated code paths:** some functionality sits behind `NC_LICENSE_KEY` /
  `NC_CLOUD`; behavior can differ between community self-host and Cloud/EE.
- **Node 22 requirement** and an actively moving `develop` branch (AI/Sync/MCP are
  newer, evolving surfaces) — expect churn if you track `develop`.
- **Vuln reporting:** `security@nocodb.com` (per `SECURITY.md`); no bug-bounty
  program is described in-repo.

---

## TL;DR

NocoDB is a mature, self-hostable **NestJS + Nuxt** platform that turns any SQL
database into an Airtable-style app with auto-generated APIs, a broad plugin
ecosystem (storage, email, chat notifications), an integrations framework
(AI/Auth/Sync), and a built-in MCP server. It is **source-available under the
Sustainable Use License v1.0 — not open source and not free for commercial reuse.**
For SWAMP, the takeaway is unchanged and reinforced: mirror the product *ideas*,
never the *code*.
