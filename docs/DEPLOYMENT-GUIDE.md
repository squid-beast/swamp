# SWAMP — Complete Deployment Guide

Everything you need to take SWAMP from this repo to a live URL: every service, every key, every environment variable, and the full surface of what's implemented.

> This is the **complete reference**. [ENVIRONMENTS.md](./ENVIRONMENTS.md) explains the migration workflow you'll use forever after, and [EMAIL-SETUP.md](./EMAIL-SETUP.md) covers email.

Your chosen setup: **Vercel** hosting · a **`*.vercel.app`** URL to start · **Google + email/password** sign-in · **daily** background jobs.

---

## 1. What you're deploying

SWAMP is a **Next.js 14** app backed entirely by **Supabase**. There is no separate backend server — the security lives in the database (row-level security), and the app talks to Postgres directly through Supabase's client.

```
                    ┌─────────────────────────────┐
   your browser ──► │  Next.js app (Vercel)       │
                    │  · marketing pages (static) │
                    │  · the workspace (/app)     │
                    │  · REST API (/api/v1)       │
                    │  · cron routes              │
                    └──────────────┬──────────────┘
                                   │  Supabase JS (RLS-scoped)
                    ┌──────────────▼──────────────┐
                    │  Supabase project           │
                    │  · Postgres + RLS  (data)   │
                    │  · Auth  (sign-in)          │
                    │  · Storage  (attachments)   │
                    │  · Realtime  (live edits)   │
                    └─────────────────────────────┘
        optional:  Google Cloud (sign-in provider + Sheets)
```

### The four external services ("connectors")

| Service | What it does | Required? |
|---|---|---|
| **Supabase** | The database, auth, file storage, realtime. The whole backend. | **Yes** |
| **Vercel** | Hosts and builds the Next.js app, runs the cron jobs. | **Yes** |
| **GitHub** (or GitLab) | Vercel deploys from your repo. | **Yes** |
| **Google Cloud** | Google sign-in provider + the Google Sheets integration. | Optional |

SWAMP does **not** use any third-party API keys beyond these — no Stripe, no analytics vendor, no email API (Supabase sends auth email). If you skip Google, it's Supabase + Vercel + GitHub only.

---

## 2. Environment variables — the complete list

Ten variables exist across the whole app. Here is every one, what reads it, and whether you need it.

| Variable | Required | Public? | Read by | What it is / where to get it |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Public | The whole app | `https://<ref>.supabase.co` — Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Public | The whole app | The **anon / public** key — Supabase → Settings → API. Safe in the browser; RLS constrains it. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** (prod) | **SECRET** | Cron routes only | The **service_role** key — Supabase → Settings → API. **Bypasses RLS.** Never `NEXT_PUBLIC_`. |
| `CRON_SECRET` | **Yes** (prod) | **SECRET** | `/api/webhooks/dispatch`, `/api/attachments/gc`, `/api/sync` | You generate it: `openssl rand -hex 32`. Gates the background jobs. |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Public | SEO (canonical, sitemap, OG) | Your public origin, no trailing slash. On `*.vercel.app` you can omit it (falls back to `VERCEL_PROJECT_PRODUCTION_URL`). Set it for a custom domain. |
| `GOOGLE_CLIENT_ID` | Optional | Public-ish | Sheets integration | Only for Google **Sheets**. Sign-in doesn't need it. Google Cloud → Credentials. |
| `GOOGLE_CLIENT_SECRET` | Optional | **SECRET** | Sheets integration | Same. Only for Sheets. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Alt | Public | The app | Accepted as an alias for the anon key (Supabase's newer name). Set **one of** this or `ANON_KEY`. |
| `VERCEL_PROJECT_PRODUCTION_URL` | Auto | — | SEO fallback | Vercel sets this itself. You never touch it. |
| `NODE_ENV` | Auto | — | Webhook SSRF guard | Set by Next/Vercel. You never touch it. |

**The rule of thumb:**
- **Local dev** (`.env.local`) → the three `NEXT_PUBLIC_SUPABASE_*` + local `SUPABASE_SERVICE_ROLE_KEY` (for integration tests).
- **Production** (Vercel env vars) → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and optionally `RESEND_API_KEY` + `EMAIL_FROM` (email) and the two Google ones.

There is one env template, **`.env.example`** — copy it to `.env.local` for local dev, and use it as the checklist for Vercel. Email setup (Resend) is its own guide: [EMAIL-SETUP.md](./EMAIL-SETUP.md).

**Which are public vs secret:** anything prefixed `NEXT_PUBLIC_` is compiled into the browser bundle — it is *meant* to be public and is safe because RLS is the real boundary. `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `GOOGLE_CLIENT_SECRET` are **secrets** — they stay server-side and must never carry the `NEXT_PUBLIC_` prefix.

---

## 3. Before you deploy — verify locally

On your Mac:

```bash
cd ~/swamp
npm install            # installs the 3 packages missing from node_modules
npm run verify         # typecheck + lint + unit tests
supabase db reset      # replays all 12 migrations locally, from zero
npm run test:int       # RLS, query engine, tokens, webhooks — on real local Postgres
npm run build          # THE GATE. Compiles OG route + static pages. Green here = green on Vercel.
```

If `npm run build` fails, fix it before going near Vercel — it will fail there too.

---

## 4. Supabase — the database

You said the project already exists / will be reset fresh. Either way the steps are the same.

### 4a. Reset (if it has old schema)

Supabase Dashboard → your project → **Settings → General → Reset database**. This wipes tables **and `auth.users`** — you have no real accounts, so this is free. A fresh project needs no reset.

> Why reset rather than migrate on top: the project's migration ledger is out of sync with the files (schema was hand-applied early, migrations later renamed). A reset makes the ledger honest so `db push` works cleanly from zero, and every future change is one command.

### 4b. Link and push

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF     # the <ref> from your project URL
supabase db push                                  # applies all 12 migrations, in order
```

`db push` shows the list and asks to confirm. Each file runs in a transaction.

### 4c. What that created — automatically, no manual SQL

| Thing | Detail |
|---|---|
| **Tables + RLS** | workspaces, bases, tables, fields, views, records, links, comments, record_audit, base_invites, api_tokens, webhooks, webhook_deliveries, file_references, and more — each with row-level security policies |
| **Extension** | `pgcrypto` (bcrypt for share passwords, hashing for tokens). Hosted Supabase ships it in the `extensions` schema; the functions are pinned to find it there. |
| **Storage bucket** | `attachments`, **private**, with access policies keyed on the base id in each file's path |
| **Realtime** | publication on `records` and `comments` so edits appear live |
| **Signup trigger** | every new user automatically gets a personal workspace |
| **anon lockdown** | anonymous requests can reach **nothing** except the public share + REST-API functions |

### 4d. Verify (Dashboard → SQL editor)

```sql
select count(*) from supabase_migrations.schema_migrations;  -- expect 12
select id from storage.buckets;                               -- expect 'attachments'
set role anon; select * from records limit 1; reset role;     -- expect: permission denied
```

The last one proves the anon lockdown is live.

---

## 5. Supabase — Auth

Dashboard → **Authentication**.

### 5a. Email / password
On by default. Nothing to configure. Two things to know:

- **Auth emails** (confirmation, password reset) use Supabase's shared SMTP — ~30/hour, spam-prone. Fine for launch; add your own under **Authentication → Emails → SMTP** before real users.
- **Password reset only works if the redirect URL is allowlisted** (next step).

### 5b. URL configuration
**Authentication → URL Configuration:**

- **Site URL:** `https://YOUR-PROJECT.vercel.app` (you get the exact URL in step 7 — set it then).
- **Redirect URLs** (allowlist — add all):
  - `https://YOUR-PROJECT.vercel.app/auth/callback`
  - `https://YOUR-PROJECT.vercel.app/auth/reset-password`
  - `https://*.vercel.app/auth/callback` *(optional — lets preview deploys sign in)*

Sign-in silently fails against any URL not on this list. This is the #1 "why won't it log in" cause.

---

## 6. Google Cloud — sign-in provider (optional but you chose it)

Skip this whole section if you launch with email/password only.

### 6a. OAuth client
[console.cloud.google.com](https://console.cloud.google.com):

1. Create/select a project.
2. **APIs & Services → OAuth consent screen** → External → app name, support email, developer email. Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. While in "Testing", add your own email as a test user.
3. **Credentials → Create credentials → OAuth client ID → Web application:**
   - **Authorized JavaScript origins:** `https://YOUR-PROJECT-REF.supabase.co`
   - **Authorized redirect URI:** `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
   - ⚠️ This URI points at **Supabase, not your app.** Supabase runs the Google handshake and then redirects to your `/auth/callback`. Getting this wrong is the most common Google-auth mistake.
4. Copy the **Client ID** and **Client secret**.

### 6b. Tell Supabase
Dashboard → **Authentication → Providers → Google** → enable → paste Client ID + secret → save.

That's all sign-in needs. The `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars are **only** for the separate Sheets integration (§10), not for sign-in.

---

## 7. Vercel — the app

### 7a. Import
1. Push the repo to GitHub (private is fine).
2. [vercel.com](https://vercel.com) → **Add New → Project** → import it.
3. It auto-detects **Next.js**. Leave build/output defaults.
4. **Set env vars before the first deploy** (next step) — the app throws at boot if Supabase env is missing, by design.

### 7b. Env vars
Project → **Settings → Environment Variables** (scope: **Production**), from `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL          = https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     = <anon / public key>
SUPABASE_SERVICE_ROLE_KEY         = <service_role key>        ← secret
CRON_SECRET                       = <openssl rand -hex 32>    ← secret
# optional, Sheets only:
GOOGLE_CLIENT_ID                  = <from §6a>
GOOGLE_CLIENT_SECRET              = <from §6a>                ← secret
```

You can skip `NEXT_PUBLIC_SITE_URL` on the vercel.app URL — the app falls back to `VERCEL_PROJECT_PRODUCTION_URL`.

### 7c. Deploy
Hit **Deploy**. When live, Vercel shows `https://YOUR-PROJECT.vercel.app`.

**Now go back to §5b and §6a** and put that exact URL into Supabase's Site URL + Redirect URLs (and, if using a custom domain later, Google's origins). Sign-in won't work until Supabase's allowlist has your real URL.

---

## 8. Background jobs (Vercel Cron)

`vercel.json` declares two **daily** jobs (Hobby-plan safe):

| Route | Schedule | Does |
|---|---|---|
| `/api/webhooks/dispatch` | `0 8 * * *` (08:00 UTC daily) | Sends queued webhook deliveries |
| `/api/attachments/gc` | `0 3 * * *` (03:00 UTC daily) | Deletes files nothing references |

Vercel reads these from `vercel.json` on deploy and passes `CRON_SECRET` as a bearer token automatically — nothing to configure in the dashboard.

- **Webhooks deliver once a day** on Hobby. To make it real-time, upgrade to Vercel **Pro** and change `"0 8 * * *"` → `"* * * * *"`.
- **Google Sheets sync is manual** — the `/api/sync` poller isn't cron'd (Hobby allows only 2 jobs). Re-sync from the app's UI works; add the cron back on Pro.

Test a job by hand:
```bash
curl -X POST https://YOUR-PROJECT.vercel.app/api/webhooks/dispatch \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## 9. Smoke test on production

Walk it in this order — each proves a different piece:

1. **Sign up (email/password)** → land in `/app`. *(Auth + DB + signup trigger.)*
2. **Sign out, sign in with Google** → back in. *(§6 wired.)*
3. **Import a CSV** → columns typed, grid renders. *(Read path.)*
4. **Add an Attachment field, upload a file** → link opens. *(Storage bucket + policies + signed URLs.)*
5. **Share a view with a password**, open incognito → prompts, then shows only un-hidden columns. *(pgcrypto, live.)*
6. **Base → API → create a token**, then `curl -H "Authorization: Bearer <token>" https://YOUR-PROJECT.vercel.app/api/v1/meta` → JSON. *(REST API + token auth.)*
7. **Forgot password** → email → reset link works. *(Email + reset allowlist.)*
8. **`/sitemap.xml`** and **`/robots.txt`** render. *(SEO.)*

If 5 or 6 error with *"function crypt/digest does not exist"*, the pgcrypto migration didn't apply — recheck §4b. (It's verified not to; that's just the symptom to recognize.)

---

## 10. The full implemented surface (reference)

So you know exactly what you're shipping.

### Pages
- **Marketing:** `/`, `/about`, `/security`, `/privacy`, `/terms`, `/cookie-policy`
- **Auth:** `/auth/sign-in`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/callback`
- **App:** `/app` (workspace home), `/app/t/[tableId]` (a table), `/app/b/[baseId]/{members,api,automations}`, `/app/import`, `/app/profile`
- **Public share:** `/s/[shareId]` (shared view / form), `/invite/[token]`

### Internal API (session-authed, RLS-scoped)
Records (query/insert/patch/delete/move/restore/links), fields (+ relational), views (+ config, share), tables (meta, export), import, comments, history, members, invites, tokens, webhooks (+ deliveries), attachments (upload), button.

### Public REST API (token-authed) — `/api/v1`
`GET /meta`, and `GET/POST/PATCH/DELETE /tables/:id/records`, `GET/PATCH/DELETE /tables/:id/records/:recordId`. Documented in [API.md](./API.md).

### Public share API (anon, share-id or form) — `/api/s/[shareId]`
`records`, `submit`, `export`.

### Cron routes (CRON_SECRET) — `/api/webhooks/dispatch`, `/api/attachments/gc`, `/api/sync`

### Features
Grid / kanban / gallery / calendar / form views · links, lookups, rollups, formulas · comments + field-level history · roles (viewer→owner) + email invites · realtime · public share links (password) · forms · REST API + scoped tokens · webhooks (conditions, signing, retries, log) · attachments · button fields · CSV/XLSX import & export · Google Sheets (manual sync).

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build fails: "Missing required environment variable" | Supabase env not set in Vercel | Set `NEXT_PUBLIC_SUPABASE_URL` + anon key (§7b) |
| Sign-in redirects then lands on an error | Redirect URL not allowlisted in Supabase | Add your exact vercel.app URLs (§5b) |
| Google button errors | Provider not enabled, or redirect URI wrong | §6 — the redirect URI is the *Supabase* callback |
| "function crypt/digest does not exist" | Migrations didn't fully apply | Re-run `supabase db push` (§4b) |
| Attachments won't upload | Bucket/policies missing | Confirm `attachments` bucket exists (§4d) |
| Webhooks never arrive | Daily cron hasn't fired yet, or `CRON_SECRET` mismatch | Trigger manually (§8); check the secret matches |
| Password-reset email never comes | Supabase shared SMTP rate limit / spam | Check spam; add custom SMTP (§5a) |
| Canonical/OG URLs point at localhost | `NEXT_PUBLIC_SITE_URL` unset AND not on Vercel | Set it, or deploy on Vercel (auto-fallback) |
| Supabase project "paused" | Free tier sleeps after 7 idle days | The daily cron keeps it awake |

---

## 12. After launch

- **Google Search Console** → add the property → submit `/sitemap.xml`.
- **Custom domain:** Vercel → Domains → add it → set `NEXT_PUBLIC_SITE_URL` to it → add its `/auth/callback` + `/auth/reset-password` to Supabase's allowlist → add it to Google's origins.
- **The change loop, forever:**
  ```
  supabase migration new <name> → write SQL → supabase db reset → npm run verify
  → git push → supabase db push → vercel --prod
  ```
  Push schema **before** code, and keep each migration backward-compatible with the code already running (see ENVIRONMENTS.md — once you have a user, breaking changes become expand/contract).

### Known limitations at launch (also on the /security page)
No third-party security audit. No API rate limiting. No custom SMTP by default. Webhooks daily (not real-time) on Hobby. No DNS-rebinding protection on webhooks. All fine for a beta; revisit before wide release.
