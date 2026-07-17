# Deploying `phase0-tier-a-wiring`

11 new migrations, 3 of which change **who is allowed to do what**.

The order is load-bearing — **migrations first, then the app** — and §2 explains why, and
what breaks in the gap between them.

Suite at time of writing: **204 unit · 204 integration · 24 e2e**, all green; 24 migrations
replay clean from empty.

---

## 0. Before you touch anything

- [ ] **A human reads `docs/REVIEW.md` §1 and §2.** These are the two commits that change
      authorization. Nobody has read them. That is the actual gate; everything below is
      mechanics.
- [ ] Confirm you're deploying what you think:
      ```bash
      git log --oneline 2caa3e3..HEAD          # 2caa3e3 is the pre-branch baseline
      git diff --stat 2caa3e3..HEAD | tail -1
      git diff 2caa3e3..HEAD -- supabase/migrations/   # the half that matters
      ```
- [ ] `npm run verify && npm run test:int && npm run test:e2e` on your machine. Not CI's
      word for it — yours.

## 1. Rehearse on a copy of production ← **do not skip this one**

The migrations touch credentials and grants. Rehearsal is the only step here that can tell
you something the test suite can't, because the test suite has never seen your data.

- [ ] Restore a production snapshot into a scratch Supabase project (Dashboard → Database →
      Backups, or `pg_dump` → a local `supabase start`).
- [ ] Record the "before" numbers:
      ```sql
      select count(*) as total,
             count(*) filter (where revoked_at is not null) as revoked,
             count(*) filter (where cardinality(scopes) = 0) as scopeless
        from api_tokens;
      ```
- [ ] Run every migration against the snapshot: `supabase db push --db-url '<snapshot url>'`
- [ ] Run the same query again. **`total` and `revoked` must be IDENTICAL.**
      `scopeless` may go up — that is the migration stripping scopes that granted nothing,
      and those tokens keep working exactly as well as they did (which is: not at all;
      that was already true, it is now merely visible).
- [ ] Prove a stripped token is still revokable — this is the trap the design avoids, so
      it is the one worth checking against real rows:
      ```sql
      update api_tokens set revoked_at = now()
       where cardinality(scopes) = 0 returning id;   -- must not error
      rollback;   -- (do this inside a transaction)
      ```
- [ ] Sanity-check the anon surface on the snapshot:
      ```sql
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname like 'swamp\_%'
         and has_function_privilege('anon', p.oid, 'execute')
       order by 1;
      ```
      **Expect exactly these 11, and nothing else** — copy-pasteable so you can diff it
      against the output rather than squint at it:
      ```
      swamp_api_count
      swamp_api_delete
      swamp_api_get
      swamp_api_insert
      swamp_api_meta
      swamp_api_patch
      swamp_api_query
      swamp_health
      swamp_shared_meta
      swamp_shared_records
      swamp_submit_form
      ```
      Anything else is a finding. Anything *missing* is a finding too — that's the public
      product losing an edge it needs.

## 2. Push — migrations first

**Order matters, and both orderings hurt. This one hurts less.**

- The **new app** calls four functions that do not exist yet (`swamp_health`,
  `swamp_group_counts`, `swamp_computed_values`, `swamp_visible_profiles`). Deploy it
  first and group-by, the members panel, computed-field refresh and `/api/health` all
  break until the migrations land.
- The **old app** (live right now) still offers five token scopes; the new CHECK allows
  two. Migrate first and, in the gap, anyone minting a token **with `schema:read` or
  `webhooks:*` ticked** gets a rejection.

The second is the lesser harm by a wide margin: one rare action, a clean error, a scope
that granted nothing anyway, for the length of a deploy. Take it.

- [ ] `supabase db push` (production)
- [ ] Watch for the migration's own assertions — `20260716090000_anon_grants.sql` and
      `20260716010000_token_scopes.sql` both `assert` their promises and will **fail the
      migration** rather than leave a wrong grant. A clean push is real evidence.
- [ ] **Immediately** merge → let Vercel deploy. Keep the gap to minutes, not hours.
- [ ] If `db push` fails halfway: **stop, do not deploy the app.** Migrations are
      transactional per-file; the app is the half that assumes they all landed.

## 3. After the deploy — 60 seconds of checks

- [ ] ```bash
      curl -sS https://www.swampy.app/api/health
      ```
      Want: `{"status":"ok","checks":{"database":"ok",...}}`. If it's `degraded`, the
      `checks` object names which half failed. This route is new — it is also the single
      most useful thing in this deploy, because it turns "is it down" into one command
      instead of a document that was wrong for months.
- [ ] ```bash
      curl -sS -D- -o /dev/null https://www.swampy.app/
      ```
      Want `200` and **no `x-vercel-error` header**. If there is one, it names the cause
      outright — don't guess, and don't trust any doc that guesses for you.
- [ ] `RESEND_API_KEY`, `CRON_SECRET`, `GOOGLE_CLIENT_ID/SECRET` show in
      `/api/health`'s `runtime` block. Each missing one silently disables a feature
      (invite email, the webhook-retry cron, Sheets sync) rather than breaking the app.
      **They are `false` on local — check they're `true` in prod if you use those.**
- [ ] Vercel → Logs, first few minutes. Watch for `permission denied for function` —
      that is the shape a revoke-gone-wrong would take, and it is the main risk this
      deploy carries.

## 4. Smoke test, in rough risk order

The first three are what this branch actually changed.

- [ ] **A share link still works.** Open one signed-out (or in a private window). This is
      the anon path the revokes ran straight through. 20 integration tests say it's fine;
      one real link says it better.
- [ ] **A public form still submits.** Same reason.
- [ ] **The members panel lists everyone**, not just you. That's `swamp_visible_profiles`,
      and "you are the only member" was the bug.
- [ ] Mint an API token. Only **two** scopes should be offered now. Use it:
      ```bash
      curl -sS -H "Authorization: Bearer $TOKEN" https://www.swampy.app/api/v1/meta
      ```
- [ ] Grid keyboard, the four bugs: type a value then **Cmd+Z immediately** (must undo —
      it used to say "Nothing to undo" and keep the edit); shift+arrow across **three+**
      rows then Delete; right-click → Delete row → Cmd+Z; type then Escape (must revert,
      **not** commit).
- [ ] Group by a column; collapse a group; reload — grouping persists.
- [ ] Import a CSV with a currency column containing `N/A`. It must render **`N/A`**, not
      **$0.00**.

## 5. If it goes wrong

- **Vercel:** Deployments → previous → Promote. Instant, and the app is stateless.
- **The migrations are the part that doesn't roll back.** They were designed so they don't
  need to: no deletes, no revokes of anyone's credentials, and every function change is
  `create or replace`. The realistic failure is over-revoking, and the fix is forward and
  small:
  ```sql
  grant execute on function public.the_one_that_broke(argtypes) to anon;
  ```
  Then tell me, because it means `ALLOWED` in `tests/integration/anon-surface.test.ts` is
  missing a genuine public edge — and that list is supposed to be the truth.

---

## What I'd need to test the deployed version

Short version: **almost nothing, and no secrets.**

### What I can do with zero access

The most important verification in this deploy — that the anon security fix actually
holds in production — needs only `NEXT_PUBLIC_SUPABASE_URL` and the anon/publishable key.
**Neither is a secret.** They're inlined into the JavaScript bundle that every visitor
downloads; I can read them out of your deployed page myself. So I can, unaided:

- Hit `/api/health` and read `x-vercel-error`.
- **Re-run the anon probes against production.** The one that matters:
  `swamp_api_table('{}', <table id>)` must answer `permission denied` and not another
  tenant's table. This is the bug I found today, and prod is where the answer counts.
- Confirm the 11-function allowlist is what prod actually enforces.
- Test a **share link** or a **public form** end to end, if you paste me a URL.

Just say go, and give me the production URL.

### What I will not do

**I won't ask for your password, and I won't type one into a login form.** That's a hard
line and it doesn't bend for a throwaway account. So I cannot sign myself in.

### What that leaves for you

- **Authenticated UI testing:** sign in yourself in the browser, then I'll drive the
  session and run §4's smoke tests. That's the whole handoff — one login.
- **§1, the production-snapshot rehearsal.** Needs your database. It's also the step I'd
  least want skipped, so it's the one worth your time.
- **`supabase db push` and the deploy.** Yours. I don't deploy.

### To make it one login instead of several

If you want the shortest possible loop: sign in, open a base with a **currency column
containing "N/A"** and **a formula column**, and leave the tab on it. That single table
exercises the currency fix, the computed-fields fix, the grid keyboard fixes and group-by
in one place, and I can drive all of §4 from there without another handoff.

---

## Webhooks fire once a day — decide this before you promise anyone otherwise

Not a bug, and not something I changed, because the fix costs money and that is your call.

`vercel.json` runs the dispatcher on `"0 8 * * *"` — **08:00, once per day**. It is the only
thing that delivers a webhook: the triggers enqueue on every record and comment change, and
nothing else ever calls `dispatchPending`. So:

- a webhook fires **up to 24 hours after** the event that caused it;
- the retry backoff (`[1, 5, 25, 120, 360]` minutes) is moot — the dispatcher is asleep for
  all of it, so each *retry* also waits a full day, and five attempts take **five days**.

The delivery code itself is the most careful in the repo — HMAC over a signed timestamp,
SSRF guards, atomic leasing, real retry accounting. It is throttled by one line of config,
almost certainly because **Vercel's Hobby plan only permits daily crons**.

Your options:
- **Leave it.** Correct if webhooks are a batch/sync feature. Say so in the UI, because
  "webhook" implies seconds to everyone who has ever used one.
- **Vercel Pro → `"* * * * *"`.** One line; the backoff starts meaning what it says.
  ⚠️ Do NOT make this change on Hobby — Vercel **rejects** sub-daily crons at deploy time,
  so it would fail the deploy rather than degrade.
- **Dispatch inline after a write** (fire-and-forget, cron as the retry safety net). No plan
  change; more code, and the write path gets slower.

`/api/attachments/gc` is on the same daily schedule (`0 3 * * *`), which is fine — garbage
collection is genuinely a batch job.

## Known, deliberate, not fixed here

- **`npm audit --omit=dev` is 2, not 0.** `next@14.2.35` carries high-severity advisories
  (SSRF, cache poisoning, DoS, App Router XSS) fixable only by a **semver-major bump to
  16**; `postcss` rides along. **This is a bigger exposure than the xlsx one this branch
  fixed** and deserves its own decision, not a footnote in a deploy.
- **The anon door reopens on the next `create function`.** No `alter default privileges`
  spelling prevents it — three were tried and measured; see the note in
  `20260716090000_anon_grants.sql`. `tests/integration/anon-surface.test.ts` is what
  catches it instead. **Get that test into CI**, or it only protects people who run the
  full suite.
- A collapsed group still fetches its rows (`ponytail:` note in the group-by migration).
