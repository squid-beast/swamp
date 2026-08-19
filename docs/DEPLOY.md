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
| **Cron** | `vercel.json` `crons` | The only real one. Replaced by system cron / a scheduler — see below |
| `runtime = "edge"` | `app/og/route.tsx`, `app/logo.png/route.tsx` | Change to `nodejs`. `next/og` supports it; these are the only two edge routes |
| `@vercel/analytics` | `features/marketing/components/consent-analytics.tsx` | Delete the import, or swap for Plausible/Umami |
| `VERCEL_GIT_COMMIT_SHA` | `app/api/health/route.ts:81` | Pass your own `GIT_SHA` build arg |
| `VERCEL_PROJECT_PRODUCTION_URL` | `shared/seo/site.ts:19` | Already falls back to `NEXT_PUBLIC_SITE_URL` — just set it |
| `maxDuration` exports | 11 route files | Inert off-Vercel. Leave them; they document intent |
| Image optimisation | Next default | Needs `sharp` in the image (one line in the Dockerfile) |

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

## Recipe A — VPS + Docker (keeping hosted Supabase)

The pragmatic middle. Supabase stays managed (auth, storage, backups, RLS all
unchanged); only the Next.js app moves.

**1. Standalone output.** In `next.config.mjs`:

```js
const nextConfig = {
  output: "standalone",   // emits .next/standalone with a self-contained server.js
  async redirects() { /* unchanged */ },
};
```

Harmless on Vercel (ignored), required for a small image.

**2. Dockerfile** (multi-stage; the runner carries no build tooling):

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time public vars must be present — Next inlines NEXT_PUBLIC_* at build.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG GIT_SHA
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    GIT_SHA=$GIT_SHA
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache sharp || true
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

**3. Compose + TLS.** Caddy terminates HTTPS and renews certs itself:

```yaml
services:
  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
        NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL}
        GIT_SHA: ${GIT_SHA}
    env_file: .env.production      # server-only secrets, never baked into the image
    restart: unless-stopped
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    restart: unless-stopped
volumes: { caddy_data: {} }
```

`Caddyfile`:

```
swampy.app, www.swampy.app {
  reverse_proxy app:3000
}
```

**4. Cron — the part that gets BETTER.** On the host:

```bash
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://swampy.app/api/cron >/dev/null
```

`/api/cron` already accepts GET **and** POST and is gated by `CRON_SECRET`, so
nothing in the app changes. Per-minute dispatch means webhooks fire in about a
minute instead of once a day. Note the 60s guard baked into the route ordering
(dispatch → gc → sync) still applies; on a VPS you could split these into
separate schedules with different frequencies.

**5. Code edits** (the seven items above): flip the two `runtime = "edge"` to
`"nodejs"`, drop `@vercel/analytics`, and read `GIT_SHA` alongside
`VERCEL_GIT_COMMIT_SHA` in the health route.

**6. Deploy loop.** A GitHub Action on push to `main`:
`ssh → git pull → docker compose up -d --build` — plus `npx supabase db push`
BEFORE the app, exactly as on Vercel. **Schema first never stops being the rule.**

## Recipe B — fully self-hosted (Supabase too)

Only if you want zero third-party dependency. Supabase publishes a compose stack
(Postgres + GoTrue + PostgREST + Storage + Realtime + Kong). What you take on:

- **Backups are yours.** `pg_dump` on a timer, off-box, and *restore-tested* —
  an untested backup is a hope.
- **Auth email** needs real SMTP (Resend works) or nobody can reset a password.
- **Storage** is a volume you must back up alongside the database.
- **Upgrades** are yours: Postgres majors, GoTrue, PostgREST.
- **RLS, migrations and every `swamp_*` function are unchanged** — SWAMP targets
  stock Postgres with pgcrypto, nothing Supabase-proprietary.

Realistic cost: a 4 GB VPS (~$10–20/mo) and a few hours a month of attention.

## Which I'd pick

**Railway or Fly, not a VPS**, unless you actively want to run servers. You get
per-minute cron, ~$5–10/mo, and roughly an hour of work — and you keep managed
Postgres, which is the part you least want to be responsible for at 3am.

Take the VPS if you want the control or plan to host other things beside it.
Take Vercel Pro if $20/mo is cheaper than your time this month; it is the only
option with zero migration.

## Before you move anything

1. **Back up.** `pg_dump` from Supabase, and download the storage bucket.
2. **Stand the new host up alongside Vercel** on a subdomain, pointed at the
   *same* Supabase. Both can serve simultaneously — it's a stateless app.
3. Run the P1 smoke test above against the new host.
4. Flip DNS. Keep Vercel deployed for a week; DNS is the rollback.
