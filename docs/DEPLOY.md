# SWAMP — Vercel deployment checklist (demo + production)

**Verdict: Yes — ready for Vercel deployment** for a demo, as long as the checklist below is completed in order. The app builds, migrations replay clean, health exists, and crons are declared in `vercel.json`. What blocks a *working* demo is almost always **missing env vars**, **migrations not pushed to hosted Supabase**, or **Auth redirect URLs**.

Priority is top → bottom. Do not skip P0.

---

## P0 — Must have (demo will fail without these)

### Services
- [ ] **GitHub repo** connected to a Vercel project (Next.js defaults).
- [ ] **Supabase project** (hosted) created and not paused.
- [ ] **Migrations applied** to that project before relying on the new app:

```bash
cd swamp
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

- [ ] Local rehearsal green (optional but strongly recommended before first prod push):

```bash
npm install && npm run verify && npm run build
# with Docker + local Supabase:
npx supabase db reset && npm run test:int
```

### Vercel → Settings → Environment Variables (Production)

| Variable | Required? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Yes** | Anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Secret — cron / admin only. Never `NEXT_PUBLIC_` |
| `CRON_SECRET` | **Yes** | `openssl rand -hex 32` — gates webhook dispatch + attachment GC |
| `NEXT_PUBLIC_SITE_URL` | Recommended | `https://your-project.vercel.app` or custom domain, no trailing slash |

Copy the template from `.env.example`. Set vars **before** the first deploy (boot throws if Supabase URL/key are missing).

### Supabase Auth (same day as first deploy)
- [ ] **Authentication → URL Configuration**
  - Site URL = your Vercel URL (or custom domain)
  - Redirect allowlist:
    - `https://YOUR_HOST/auth/callback`
    - `https://YOUR_HOST/auth/reset-password`
    - optional: `https://*.vercel.app/auth/callback` for previews
- [ ] Email/password provider on (default).
- [ ] (Demo optional) Google provider: OAuth client redirect must be  
  `https://YOUR_REF.supabase.co/auth/v1/callback` (Supabase, not Vercel).

### Deploy order
1. [ ] `supabase db push` (schema first)
2. [ ] Merge / deploy on Vercel (app second)
3. [ ] Confirm deploy has no `x-vercel-error`

---

## P1 — Demo smoke test (do these in order)

- [ ] `curl -sS https://YOUR_HOST/api/health` → `"status":"ok"` (or `degraded` with a named check — fix that check).
- [ ] Open `/` → 200.
- [ ] Register / sign in → land in `/app`.
- [ ] Import a small CSV → grid renders.
- [ ] Create an API token (`records:read` + `records:write`) →  
  `curl -H "Authorization: Bearer $TOKEN" https://YOUR_HOST/api/v1/meta`
- [ ] Ingest one lead:  
  `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
   -d '{"Email":"demo@example.com"}' https://YOUR_HOST/api/ingest/TABLE_ID` → `201`
- [ ] Share a form view → submit in a private window → row appears.
- [ ] (Optional) Workflow → Slack/Discord/generic with a test URL; remember **Hobby delivers once/day** unless you change the cron on Pro.

---

## P2 — Nice for a polished demo (not blockers)

| Item | Why |
|---|---|
| `RESEND_API_KEY` + `EMAIL_FROM` | Invite emails from the app; without them, copy the invite link |
| Supabase custom SMTP → Resend | Better deliverability for signup / password reset |
| Paste branded HTML from `docs/email/*.html` into Supabase Auth templates | Looks finished |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sheets sync only — not needed for Google **sign-in** |
| Custom domain + `NEXT_PUBLIC_SITE_URL` | Cleaner share/invite links |
| Vercel **Pro** + change `/api/cron` schedule to `* * * * *` | Near-real-time workflows |

### Email (short)
1. Resend → verify domain → API key.
2. Vercel: `RESEND_API_KEY`, `EMAIL_FROM=SWAMP <hello@yourdomain>`.
3. Supabase → Auth → SMTP: host `smtp.resend.com`, port `465`, user `resend`, pass = same key.
4. Optional: Auth email templates from `docs/email/confirm-signup.html`, `reset-password.html`, `change-email.html`.

### Background jobs (`vercel.json`)

| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron` | `0 8 * * *` (daily) | Fan-out: webhook dispatch → attachment GC → sheet sync |

One cron entry runs all three jobs (Hobby caps the entry *count* at two as well
as the frequency). Each job is individually reachable for testing —
`/api/webhooks/dispatch`, `/api/attachments/gc`, `/api/sync` — same auth, GET or
POST.

Manual dispatch:

```bash
curl -X POST https://YOUR_HOST/api/webhooks/dispatch \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## P3 — After the demo / ongoing

- [ ] Push schema **before** app code when adding migrations.
- [ ] Keep Hobby cron daily unless you upgrade.
- [ ] Watch Vercel logs for `permission denied for function` after schema changes.
- [ ] Re-check `/api/health` after every production deploy.

---

## Ready? Decision table

| Question | Answer |
|---|---|
| Can this repo deploy on Vercel as a Next.js app? | **Yes** |
| Is code/build/test state deployable? | **Yes** (verify + build + migrations are the gates) |
| Will a blank Vercel project “just work”? | **No** — need Supabase + env + `db push` + Auth URLs |
| Is it demo-ready for lead capture? | **Yes**, after P0 + P1 (ingest + form + token) |
| Are workflows real-time on free Vercel? | **No** — daily cron; say so in the demo or upgrade |

**Minimum for a 10-minute demo:** P0 complete + sign-in + one table + one ingest or form submit + `/api/health` ok.

Product usage and API details: **[GUIDE.md](./GUIDE.md)**.

---

# If Vercel isn't the answer — running SWAMP elsewhere

Written as a contingency, not a migration in progress. Nothing below is applied
to the repo; each step says exactly what to change when you decide to move.

## First, the honest coupling audit

SWAMP is a stock Next.js app. Grepping for what actually ties it to Vercel turns
up **seven things, all small**:

| Coupling | Where | Effort to remove |
|---|---|---|
| **Cron** | `vercel.json` `crons` | ✅ **done** — a per-minute sidecar in `docker-compose.yml` |
| `runtime = "edge"` | `app/og`, `app/logo.png` | ✅ **done** — both on `nodejs`; verified rendering real PNGs from the standalone server |
| `@vercel/analytics` | `consent-analytics.tsx` | ✅ **done** — gated on `NEXT_PUBLIC_ANALYTICS=vercel`, inert elsewhere |
| `VERCEL_GIT_COMMIT_SHA` | `app/api/health/route.ts` | ✅ **done** — falls back to `GIT_SHA` |
| `VERCEL_PROJECT_PRODUCTION_URL` | `shared/seo/site.ts` | ✅ nothing to do — `NEXT_PUBLIC_SITE_URL` already takes precedence |
| `maxDuration` exports | 11 route files | Inert off-Vercel. Left in place; they document intent |
| Image optimisation | Next default | ✅ **done** — `sharp` installed in the runner stage |

**Every code-side item is already applied and on `main`.** What remains is
infrastructure, and it is in the runbook below.

There is **no** Vercel-specific storage, KV, queue, or middleware API in use.
The database is Supabase and doesn't care where the app runs. That is why this
is a weekend, not a quarter.

## The options

| Option | Cost | Cron | Move effort | When it's right |
|---|---|---|---|---|
| **Vercel Pro** | ~$20/mo | Per-minute ✅ | none | You just want real-time workflows and no ops |
| **Railway / Render / Fly.io** | ~$5–10/mo | Built-in schedulers ✅ | ~1 hour | Managed, but not Vercel. Least ops for the money |
| **VPS + Docker** (Hetzner/DO) | ~$5/mo | Real crontab ✅ | ~half a day | You want control, and per-minute cron for free |
| **VPS + self-hosted Supabase** | ~$10–20/mo | ✅ | ~2 days | No third-party dependency at all. Most ops |

**The thing worth knowing:** the daily-cron limitation that makes "Workflows"
a once-a-day digest is a *Vercel Hobby* limit, not a SWAMP one. On any VPS a
one-line crontab gives you per-minute dispatch — so moving off Vercel and paying
for Pro solve the same product problem, and the VPS is cheaper.

> **Decision taken: VPS + self-hosted Supabase.** The runbook below is that path.
> The repo already carries what it needs — `Dockerfile`, `docker-compose.yml`,
> `Caddyfile`, `output: "standalone"`, both image routes moved off the edge
> runtime, and a per-minute cron sidecar. Verified locally: the standalone server
> boots and `/og`, `/logo.png` and `/api/health` all answer 200.

## The runbook — VPS + self-hosted Supabase

### The one trap that will cost you an afternoon

**`NEXT_PUBLIC_*` is compiled in at BUILD time — including into the server
bundle — and cannot be overridden at runtime.** Verified, not assumed: a test
image built with `127.0.0.1:54321` and run with
`NEXT_PUBLIC_SUPABASE_URL=host.docker.internal` still had the build value
embedded in `.next/server/**/*.js`, and `/api/health` reported the database
unreachable while the container could reach it perfectly from a shell.

Consequences, all of which look like bugs if you don't know this:

* The image is **environment-specific**. Build it with the final public URL —
  `https://api.yourdomain.com`, the address a *browser* resolves. Rebuild to
  change it; `docker compose up` with a new env var will not.
* `docker-compose.yml` therefore passes these as `build.args` **and** the
  secrets separately via `env_file`. Do not move a `NEXT_PUBLIC_*` into
  `env_file` and expect it to take.
* Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`) go the
  other way: **runtime only, never build args** — a build arg is readable in the
  image history by anyone who can pull it.

### 0. What SWAMP actually needs from Supabase

Worth knowing before you trust the stack: SWAMP targets **stock Postgres**. There
is nothing proprietary in the 44 migrations — no Supabase-only SQL. What it uses:

| Component | Used for | If it's missing |
|---|---|---|
| **Postgres 15+** with `pgcrypto` | `crypt`/`gen_salt` (share passwords), `gen_random_bytes` (share ids), `digest` | Migrations fail immediately — loud, not silent |
| **GoTrue** (auth) | `auth.users`, `auth.uid()` — every RLS policy reads it | Nobody can sign in; RLS denies everything |
| **PostgREST** | The `anon`/`authenticated`/`service_role` roles, `swamp_api_*` RPCs | The whole data layer |
| **Storage** | Attachments; RLS policies on `storage.objects` | Uploads fail; everything else works |
| **Realtime** | The `supabase_realtime` publication — live grid edits, notifications | Falls back to no live updates; not fatal |

`extensions` schema placement matters and is already handled: every function
touching pgcrypto sets `search_path = public, extensions, pg_temp`, which resolves
on both the local CLI and a self-hosted stack.

### 1. The box

2 vCPU / 4 GB minimum — Postgres, GoTrue, PostgREST, Storage, Realtime, Kong,
the app and Caddy is roughly 2.5 GB resident. Hetzner CX22 or DO 4GB (~$8–12/mo).
Debian 12 or Ubuntu 24.04, Docker + compose plugin, and a firewall allowing only
22/80/443.

### 2. Supabase, self-hosted

```bash
git clone --depth 1 https://github.com/supabase/supabase
cp -r supabase/docker ~/supabase-stack && cd ~/supabase-stack
cp .env.example .env
```

**Generate every secret** — the defaults in that file are public knowledge:
`POSTGRES_PASSWORD`, `JWT_SECRET` (≥32 chars), then the `ANON_KEY` and
`SERVICE_ROLE_KEY` JWTs signed with it (Supabase's self-hosting docs have the
generator), plus `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`.

Put Kong behind Caddy on its own hostname — `https://api.yourdomain.com` — and
**do not expose 5432 publicly.**

```bash
docker compose up -d && docker compose ps
```

### 3. Move the data across

You have live data on the hosted project. Three separate things, and the second
is the one people forget:

```bash
# a. Schema + data + the migration ledger, so `db push` knows what's applied.
pg_dump "$HOSTED_DB_URL"   --schema=public --schema=auth --schema=storage --schema=supabase_migrations   --no-owner --no-privileges -Fc -f swamp.dump

psql "$NEW_DB_URL" -c 'create schema if not exists supabase_migrations;'
pg_restore -d "$NEW_DB_URL" --no-owner --no-privileges swamp.dump
```

**b. `auth.users` carries bcrypt password hashes**, so the dump above preserves
logins — but only if `JWT_SECRET` differs, which it will: every existing session
cookie is invalidated and **everyone must sign in again**. Say so before you cut
over, not after.

**c. Storage objects are FILES, not rows.** The dump moves the metadata; the
bytes live in the hosted bucket. Download them (Supabase CLI or the S3-compatible
endpoint) and drop them into the new stack's storage volume. Skipping this gives
you records whose attachments 404 — with metadata that insists they exist.

### 4. Apply anything newer

```bash
npx supabase db push --db-url "$NEW_DB_URL"
```

The CLI reads `supabase_migrations.schema_migrations`, which came across in the
dump, so this applies only what the hosted project hadn't seen. Verify with
`npx supabase migration list --db-url "$NEW_DB_URL"` — every row should pair.

### 5. The app

```bash
git clone <your repo> ~/swamp && cd ~/swamp
cp .env.example .env.production && $EDITOR .env.production
```

Set `NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain.com` (the **browser-reachable**
address — it is inlined into the client bundle), the new anon and service-role
keys, `NEXT_PUBLIC_SITE_URL`, a fresh `CRON_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM`,
and leave `NEXT_PUBLIC_ANALYTICS` empty.

Edit `Caddyfile` for your hostnames, then:

```bash
GIT_SHA=$(git rev-parse HEAD) docker compose --env-file .env.production up -d --build
```

### 6. Auth URLs and SMTP

In the Supabase stack's `.env`: `SITE_URL=https://yourdomain.com`,
`ADDITIONAL_REDIRECT_URLS` covering `/auth/callback` and `/auth/reset-password`,
and **SMTP** (`smtp.resend.com:465`, user `resend`, pass = your Resend key).
Without SMTP, password reset and email confirmation silently do nothing — the
most common self-host complaint, and it looks like an app bug.

### 7. Backups — now entirely yours

This is the part hosting was doing for you. Nightly, off-box, and **restore-tested**:

```bash
0 3 * * * pg_dump "$DB_URL" -Fc -f /backup/swamp-$(date +\%F).dump && \
          find /backup -name 'swamp-*.dump' -mtime +14 -delete
```

Back up the **storage volume too**, and once — actually restore into a scratch
database and open the app against it. An untested backup is a hope, not a backup.

### 8. Cutover

Both stacks can serve at once; the app is stateless. Bring the VPS up on a
subdomain against the new Supabase, run the P1 smoke test above against it, then
flip DNS. Keep Vercel deployed a week — DNS is the rollback.


