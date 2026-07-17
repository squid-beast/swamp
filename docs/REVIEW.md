# Review guide — `phase0-tier-a-wiring`

15 commits, 62 files, ~6,300 insertions, against `main` at `2caa3e3`.

**Nothing here has been read by a human.** It was written by Claude and verified by
running it, which catches a different class of mistake than review does. Two commits
change **who is allowed to do what** — those need eyes before merge. The rest can be
skimmed.

Read in the order below: it is risk order, not chronological.

```bash
git log --oneline 2caa3e3..HEAD
git diff 2caa3e3..HEAD -- supabase/migrations/   # the half that matters
```

**Suite state:** 204 unit · 201 integration · 24 e2e. All green.
`npm audit --omit=dev`: **2** (see §"Known and deliberate").

---

## Read these two properly

### 1. `1cf00e1` — anon grants, and a cross-tenant read
`supabase/migrations/20260716090000_anon_grants.sql`

**The claim:** `revoke ... from anon` has never worked anywhere in this schema. Postgres
grants EXECUTE to **PUBLIC** on every `create function`; anon is a member of PUBLIC;
revoking from `anon` leaves the PUBLIC entry, which is sufficient on its own. ~59
`swamp_*` functions were anon-reachable while `platform.sql:1750-1754` described the
opposite.

**Why it wasn't an incident:** none of those functions relied on the grant. `auth.uid()`
is NULL for anon, or a sha256 token lookup fails, or the function `returns trigger` and
PostgREST won't publish it. The outer door was open; every inner door held.

**Except one.** `swamp_api_table`'s guard was `v_t.base_id <> (p_ctx->>'baseId')::uuid`,
and `p_ctx` is caller-supplied. `'{}'` → right operand NULL → `<>` yields NULL → plpgsql
reads NULL as false → the raise is skipped → the row returns. A **wrong** baseId was
rejected; a **missing** one was waved through, to an anon caller with no token.

**Verify it yourself** (this is the whole review, in four commands):
```sql
-- Before the fix, this returned another tenant's table row:
set role anon;
select * from public.swamp_api_table('{}'::jsonb, '<any table id>');
-- now: ERROR: permission denied for function swamp_api_table

-- And the guard holds even for a caller who IS allowed in:
reset role;
select * from public.swamp_api_table('{}'::jsonb, '<any table id>');
-- now: ERROR: swamp: no such table
```

**What to challenge:**
- **Is the KEEP list right?** 10 functions stay anon-callable: `swamp_shared_meta`,
  `swamp_shared_records`, `swamp_submit_form`, and the seven `swamp_api_*` endpoints.
  Every one is a deliberate public edge whose credential is a share id or a token —
  never the anon key. **If one of these should not be public, that is the finding.**
- **Did I over-revoke?** `swamp_base_member_role` keeps its `authenticated` grant on
  purpose: it is called from `swamp_base_role_in`, which is SECURITY **INVOKER** and used
  inside the `bases` RLS policy — and an RLS expression evaluates with the *querying*
  role's privileges. Taking EXECUTE from `authenticated` there breaks ordinary reads. Only
  PUBLIC and anon come off. This is the most likely place for me to have been wrong.
- **One measured behaviour change:** anon probes against `storage.objects` go from
  "0 rows" to `permission denied for function`. Still denied; the real upload path uses
  signed URLs. Cosmetic, but it is a change.
- **Scope — this changed after the first draft, and the change is the point.** The
  migration originally named 16 functions by hand. Then
  `tests/integration/anon-surface.test.ts` enumerated the schema and found **~35 more**
  anon could still execute (`swamp_to_bool`, `swamp_writable_keys`,
  `swamp_view_filter_json`, the trigger functions). All SECURITY **INVOKER**, so RLS binds
  them and anon holds no table grants — inert. But "inert" is the word that described this
  entire hole for two years, and a hand-list cannot be complete by construction.

  So the revoke is now **catalog-driven**: every `swamp_%` function not on an 11-name
  allowlist loses PUBLIC and anon. **This is a wider blast radius than the audit examined
  — it is the main thing to push back on.** What protects it: `authenticated` is never
  touched; 20 integration tests drive the real anon share path; 24 e2e drive the app. All
  green after the sweep. If you think a helper needs anon, say which.

- **The "stop it reopening" line does not work, and now says so.** I wrote
  `alter default privileges ... revoke all on routines from anon` — which is the exact
  no-op this migration exists to fix, one line below the lesson. Measured: a function
  created straight after it still comes out with `=X/postgres` and anon can execute it.
  The PUBLIC spellings don't help either. All three attempts are recorded in the migration
  rather than shipped as though they worked. **The anon door reopens on the next
  `create function`** — the guard test is the only thing that catches it, so **get it into
  CI.**

**Tests:** `tests/integration/anon-surface.test.ts` is the important one — it asks the
whole schema "what can the internet execute?" in one query and fails if the answer isn't
exactly the 11-name allowlist. That framing is the fix: per-function tests can only check
functions someone already suspected, which is the blind spot that let this run for two
years. Also `api-tokens.test.ts` — "is refused EXECUTE on the internals", "still reaches
the functions that are anon BY DESIGN", "cannot read another tenant's table by omitting
the baseId". The migration asserts both directions inline too, so a bad revoke fails the
migration rather than production.

> The test that should have caught this **passed for the wrong reason for two years**. It
> called `swamp_token_context` with a bogus token and asserted "an error came back". An
> error always comes back. It proved the token check worked while claiming to prove the
> grant was gone. It now asserts `permission denied` specifically — verified by
> re-granting anon and watching it fail.

### 2. `e8c78a6` — who can see a colleague's name and email
`supabase/migrations/20260716020000_visible_profiles.sql`

**The claim:** `init.sql:19`'s `"profiles: read own" using (auth.uid() = id)` meant the
members panel listed exactly one person — you. `listMembers` mapped over `profiles ?? []`
and dropped every member it couldn't read.

`swamp_visible_profiles(uuid[])` is SECURITY DEFINER and returns `id, first_name,
last_name, email, avatar_url` for people who share a workspace or base with you.

**What to challenge:**
- **The predicate is the whole security control.** Read it and decide whether "shares a
  workspace or base with the caller" is the line you want. This function bypasses RLS by
  design — the predicate is all that stands there.
- **Is `dob` really absent?** It is in `profiles`. It is not in the return type. Check the
  `returns table(...)` clause, not my word for it.
- **Is it revoked from PUBLIC as well as anon?** (Yes — but §1 is exactly why that
  question is worth asking every time.)
- Email is disclosed to colleagues. That is the intent — it is a collaboration product —
  but it is a disclosure, and it is new.

**Tests:** `tests/integration/sharing.test.ts`. A test caught a real bug in my first draft:
it joined `base_members` to itself, but a base **owner** usually has no `base_members` row
(the role falls back to the workspace via `swamp_base_role_in`'s coalesce), so owners were
invisible.

---

## Also security-shaped, lower risk

### `6893fde` — the token migration
`supabase/migrations/20260716010000_token_scopes.sql`

Rewritten to **delete nothing and revoke nothing**. Strips three scopes that gate nothing,
then narrows the CHECK. Verified against a simulated restored-production copy: 4 legacy
tokens in, 4 out, 0 revoked.

**The one thing to check:** there is deliberately **no** `cardinality(scopes) >= 1`
constraint. A CHECK fires on UPDATE too, against the NEW row, regardless of which column
you touched — so it would make a `{}`-scoped token impossible to **revoke**. (`NOT VALID`
doesn't help: it skips the initial scan and still fires on every later UPDATE. Both
verified on a throwaway table.) Emptiness is guarded at `swamp_create_token` instead.
If you disagree, the argument to beat is "a dead credential you cannot revoke is worse
than a row with an empty array".

### `20260716000000_object_management.sql` (in `913fb19`) — base soft-delete guard
Closes a real hole: `bases: creator update` vs `bases: owner delete`, but soft delete **is
an UPDATE**, so deletion travelled through the *creator* policy. A trigger now requires
owner. Ask: does it fire on every writer? Does it wrongly block **un**-delete? Does it
break service-role paths?

---

## Skim

| Commit | What | Risk |
|---|---|---|
| `85a6838` | Currency cell rendered **$0.00** for "N/A" — `Number("")` is 0, not NaN, so the "don't invent a number" guard never fired | Low, but it was showing wrong data |
| `97554e4` | Four keyboard bugs. The real one: `CommandStack.run()` pushed to the undo stack only *after* the server round-trip, so Cmd+Z right after typing said "Nothing to undo" and kept the edit | Low; `commands.ts` now serialises stack ops — check the queue can't wedge on a rejection (there's a test) |
| `7aef977` | `xlsx` → SheetJS 0.20.3 (npm's is abandoned, 2 unfixed highs). One import site. Parser had **no test**; now has 10 | Low; new dep source is a vendor CDN, lockfile committed |
| `d345f8a` | Retract the 503 claim; add `/api/health` | None |
| `a08e274`, `b8b522e` | Group-by: engine + grid | Medium size, no authz |
| `3f72555`, `d8b340a`, `ab7965e`, `e2498a3`, `6e0c1c0`, `913fb19` | Tier-A wiring | Low |

---

## Known and deliberate

- **`npm audit --omit=dev` is 2, not 0.** `next@14.2.35` carries a stack of
  high-severity advisories (SSRF, cache poisoning, DoS, XSS in App Router) fixable only by
  a **semver-major bump to 16**; `postcss` comes with it. **This is a bigger exposure than
  xlsx was** and is out of scope for a blocker sweep. It needs its own decision.
- **~33 functions still hold the PUBLIC grant, unaudited.** §1 covers the 26 that were
  actually reachable-and-interesting. Follow-up.
- A collapsed group still fetches its rows (`ponytail:` note in
  `20260716070000_group_by.sql`).

## Before merge

1. A human reads §1 and §2.
2. Restore a production snapshot, run every migration against it, then:
   ```sql
   select count(*) from api_tokens;                              -- unchanged
   select count(*) from api_tokens where revoked_at is not null; -- unchanged
   ```
3. `npm run verify && npm run test:int && npm run test:e2e` → all green.
4. Deploy, then `curl -sS https://www.swampy.app/api/health`.
5. Watch `x-vercel-error` on the first requests. It names the cause outright — which is
   what §"Retract the 503" exists to make true.
