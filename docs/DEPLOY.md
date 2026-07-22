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
| Vercel **Pro** + change webhook cron to `* * * * *` | Near-real-time workflows |

### Email (short)
1. Resend → verify domain → API key.
2. Vercel: `RESEND_API_KEY`, `EMAIL_FROM=SWAMP <hello@yourdomain>`.
3. Supabase → Auth → SMTP: host `smtp.resend.com`, port `465`, user `resend`, pass = same key.
4. Optional: Auth email templates from `docs/email/confirm-signup.html`, `reset-password.html`, `change-email.html`.

### Background jobs (`vercel.json`)

| Route | Schedule | Purpose |
|---|---|---|
| `/api/webhooks/dispatch` | `0 8 * * *` (daily) | Deliver queued workflows |
| `/api/attachments/gc` | `0 3 * * *` (daily) | Orphan file cleanup |

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
