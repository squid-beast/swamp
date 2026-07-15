# SWAMP — launch readiness

Written the day of deploy. Four parts: what makes SWAMP better, quick wins that
raise productivity, an SEO audit, and the exact steps to go live (plus how to get a
clean production database).

---

## 1. What makes SWAMP better than the alternatives

The category (Airtable, NocoDB, Baserow, Teable) all do "a spreadsheet that's
really a database." SWAMP's edge is **where the rules live and how honest it is**,
not feature count.

| Strength | Why it beats the field |
|---|---|
| **Security is in the database, not the app** | Every row is guarded by Postgres row-level security. Most tools check permissions in the application layer, where one UI bug leaks data. SWAMP can't: the thing that decides if you can see a row is the thing that stores it. There's a test that proves a non-owner gets nothing. |
| **Hidden means gone, not off-screen** | A hidden column on a shared view is *absent from the query* — a visitor can't filter or search by it, so they can't infer a salary from the row count. Competitors typically just hide it in the UI. |
| **API tokens can't outlive your access** | A token's permissions are recomputed from live membership on every call. Demote someone and their integration stops on the next request — no waiting for a key rotation. This is rare even in mature tools. |
| **Append-only audit log** | Field-level history ("Alice changed Stage from Open to Won"), and nobody — not even the base owner — can edit it. |
| **Stable field keys in the API** | Records are keyed by a stable field key, not the column name, so renaming a column in the UI doesn't break your nightly script. |
| **Signed webhooks + SSRF protection** | Every delivery is HMAC-signed and can't be aimed at a private address. |
| **Honest and open** | MIT-licensed, free in beta, real export to CSV/XLSX and a REST API — no lock-in step, and the marketing pages say what *isn't* built. |

**Where SWAMP is behind (be honest about it):** it's young — fewer integrations,
no mobile app, no visual automation builder (webhooks + button field only), a
smaller template/ecosystem, and no third-party security audit yet. Those are the
gaps competitors will point at. Section 2 is the cheapest way to close the ones
that actually cost you users.

---

## 2. Quick wins that raise productivity (ranked by value ÷ effort)

Features that are genuinely simple to add and remove real friction. (Verify each
against the current build before starting — some may be partially there.)

| Idea | Why it helps | Effort |
|---|---|---|
| **Starter templates** (CRM, content calendar, bug tracker) | Kills the empty-state. New users get a working base in one click instead of a blank grid — the single biggest driver of activation. | Moderate |
| **Keyboard-shortcut cheatsheet** (press `?`) | You already have deep keyboard nav; a discoverable overlay makes power users out of everyone. | Quick win |
| **Global search across a base** | Find any record without knowing which table it's in. Everyday time-saver. | Moderate |
| **Column freeze / pin first column** | Wide tables become usable. Expected in every grid tool. | Quick win |
| **Row-height / density toggle** | Comfortable vs compact. Cheap, visible polish. | Quick win |
| **Duplicate record / table / view** | People build by copying. Removing the "rebuild it by hand" step is pure productivity. | Quick win |
| **Group by (grid grouping)** | Collapse rows by a single-select. High-value view feature. | Substantial |
| **Notifications center** | Comment @mentions and share activity in one place; you already send invite emails, so the plumbing exists. | Moderate |
| **Append CSV into an existing table** | Today import creates a new table; letting it append is a common real workflow. | Moderate |
| **Trash / restore view** | Soft-delete already exists in the data model — surface it so a wrong delete isn't scary. | Quick win |

Top three to do first: **starter templates**, the **`?` shortcut overlay**, and
**global search**. They compound: templates get people in, the overlay makes them
fast, search keeps them.

---

## 3. SEO audit

### Executive summary

The technical foundation is **strong** — better than most launches. Metadata,
canonicals, sitemap, robots, structured data, and server rendering are all correct
and done. The one thing missing is **content**: there's no blog, so there's nothing
to rank for the long-tail terms you can actually win. Overall: solid foundation,
one strategic gap. Top three priorities: (1) publish long-tail articles, (2) submit
to Search Console + directories on launch day, (3) add a `LICENSE`-backed
"open source" credibility loop (done — the LICENSE now exists).

### On-page status (what's already right)

| Check | Status | Detail |
|---|---|---|
| Title tags | Pass | Per-page, brand appended via template, target phrase in the home title (not "SWAMP — Home"). |
| Meta descriptions | Pass | Unique per page, 150–160 chars, written from one source. |
| One H1 per page | Pass | Home H1 is the target phrase; every section is an H2. |
| Canonicals | Pass | Absolute, per-page, driven by `metadataBase`. |
| Sitemap + robots | Pass | Generated from one nav source; app/auth/share pages `noindex`. |
| Structured data | Pass | Organization, WebSite, SoftwareApplication, FAQPage, Breadcrumbs, **Person** (you, as founder → name search). |
| OG / Twitter cards | Pass | Per-page generated OG image route. |
| Render / speed | Pass | Server-rendered; the product mock is HTML/CSS, not a heavy screenshot. |
| Author identity | Pass | `authors`/`creator` now name Lohith Kumar Neerukonda, linked to /about. |

### On-page issues to fix

| Page | Issue | Severity | Fix |
|---|---|---|---|
| Site-wide | `NEXT_PUBLIC_SITE_URL` must be `https://swampy.app` in prod, or every canonical/OG URL points at localhost | **Critical** | Set it in Vercel before/at deploy (see §4). |
| Site-wide | No blog = nothing ranking for long-tail | High | Add a `/blog` and publish (see keyword table). |
| Home | Particle canvas + framer run JS continuously | Low | Fine for now; if Core Web Vitals dip, gate the canvas to `md+` screens. |

### Keyword opportunities (chase long-tail, not the head term)

| Keyword | Difficulty | Opportunity | Intent | Content type |
|---|---|---|---|---|
| turn a spreadsheet into a database | Easy | High | Informational | How-to article |
| spreadsheet that links tables | Easy | High | Informational | How-to article |
| shared database with a public form | Easy | High | Informational | Feature article |
| how to make a database from a CSV | Easy | Medium | Question | How-to |
| open source airtable alternative | Hard-ish | High | Commercial | Comparison page |
| free collaborative database for small teams | Medium | High | Commercial | Landing page |
| self-hosted airtable alternative postgres | Medium | Medium | Commercial | Technical article |
| simple CRM database no-code | Medium | Medium | Commercial | Use-case page |
| kanban board from a spreadsheet | Easy | Medium | Informational | How-to |
| airtable alternative | Hard | Low | Commercial | Don't chase yet |
| swamp / swampy.app (branded) | Easy | High | Navigational | Own it day one |

### Technical checklist

| Check | Status | Notes |
|---|---|---|
| HTTPS | Pass (after deploy) | Vercel provides it. |
| Mobile-friendly | Pass | Responsive; viewport + theme-color set. |
| Structured data | Pass | See above. |
| Crawlability | Pass | sitemap.xml + robots.txt live; noindex on private routes. |
| Broken links | Pass | Footer/nav point only at real pages (no dead "Careers"/"Docs"). |
| Indexation | Action needed | Submit sitemap + request indexing in Search Console (§4). |

### SEO action plan

**Quick wins (launch week):** set `NEXT_PUBLIC_SITE_URL`; verify Search Console +
submit sitemap; request indexing on `/`, `/about`, `/security`; list on
AlternativeTo + openalternative.co; add GitHub repo topics.

**Strategic (this quarter):** publish one long-tail article a week starting with
"turn a spreadsheet into a database"; then a "SWAMP vs a spreadsheet" comparison
page; build an internal-linking cluster from those to the home page.

---

## 4. Deploy now — go-live checklist

Do these in order. Full detail is in `DEPLOYMENT-GUIDE.md`; this is the launch-day
sequence.

**A. Vercel environment variables** (Project → Settings → Environment Variables)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `NEXT_PUBLIC_SITE_URL=https://swampy.app`  ← critical for SEO
- `CRON_SECRET`
- `RESEND_API_KEY`, `EMAIL_FROM=SWAMP <hello@swampy.app>`

**B. Supabase (prod project `jucalmdvwnmotzagorui`)**
1. Apply the 13 migrations: `supabase db push --linked` (or a reset — see §5).
2. Auth → URL config: Site URL `https://swampy.app`; add redirect URLs
   `https://swampy.app/**` and the `/auth/callback` path.
3. Auth → Providers → Google: paste `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
   In Google Cloud, set the authorized redirect URI to your Supabase callback
   (`https://jucalmdvwnmotzagorui.supabase.co/auth/v1/callback`).
4. Auth → Email templates: paste the three from `docs/email/`
   (confirm-signup, reset-password, change-email).
5. Auth → SMTP: enable custom SMTP → host `smtp.resend.com`, port 465, user
   `resend`, password = your `RESEND_API_KEY`, sender `hello@swampy.app`.
6. Storage: confirm the private attachments bucket exists (name must match the app).

**C. Resend**
- Add and verify the `swampy.app` domain (DNS: SPF/DKIM records it gives you).
- The same API key powers app invites (env) and Supabase SMTP (step B5).

**D. Domain (Hostinger → Vercel)**
- Add `swampy.app` in Vercel; point Hostinger DNS at Vercel (A/CNAME as instructed);
  wait for SSL to go green.

**E. Search Console**
- Add `swampy.app` as a Domain property → add the TXT record at Hostinger → verify.
- Submit `https://swampy.app/sitemap.xml`; request indexing on `/`, `/about`,
  `/security`.

**F. Smoke test (2 minutes, on the live domain)**
- Home loads, light/dark toggle works, particle backdrop animates.
- Sign up with email → confirmation email arrives (check "show images" for the logo).
- Sign in with Google.
- Import a CSV → grid renders; share a view link; create an API token.

---

## 5. How the database tables get clean

**SWAMP never seeds data.** A clean production database is simply *the 13 migrations
applied and nothing else*. There is no demo data to remove.

**If you want a pristine slate before launch** (recommended, since you've been
testing):

```bash
# DESTRUCTIVE: drops the public schema and re-runs all 13 migrations on the
# LINKED prod project. Wipes every row and every user. Pre-launch only.
supabase db reset --linked
```

**If prod is already migrated** and you only tested locally, it may already be
clean. Confirm with:

```bash
supabase migration list        # Local and Remote should both show 13 migrations
```

**After a reset, verify (don't seed anything):**
- All tables have RLS enabled (the migrations do this; a table without RLS is the
  one dangerous mistake).
- `pgcrypto` lives in the `extensions` schema (hosted Supabase default — the
  migrations already name it correctly).
- The attachments storage bucket still exists (reset touches the DB schema, not
  storage or auth settings — recreate the bucket if needed).
- Tables are empty. The signup trigger that creates a workspace on first login is
  expected behaviour, not seed data.

**One caution:** `supabase db reset --linked` wipes real users too. Only run it
before you have real signups. After launch, use **forward migrations only** (new
timestamped files) — never edit an applied migration.

---

## The one-line status

Ship it. The build is clean (typecheck + lint green), the SEO foundation is right,
the security model is the real differentiator, and the only launch-blocking item is
setting `NEXT_PUBLIC_SITE_URL=https://swampy.app` in Vercel so your canonicals don't
point at localhost.
