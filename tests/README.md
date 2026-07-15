# Tests

Three runners, three jobs.

| | Runner | Where | What it tests |
|---|---|---|---|
| **Unit** | Vitest (jsdom) | `tests/unit/` | Pure functions. Inference, parsers, the formula compiler, the command stack, TSV. No database. |
| **Integration** | Vitest (node) | `tests/integration/` | The **database**, against real Postgres — RLS, the query engine, concurrency, triggers. |
| **End-to-end** | Playwright | `tests/e2e/` | The real app, real database, real browser. |

```bash
npm test            # unit — fast, no database
npm run test:int    # integration — needs `supabase start`
npm run test:e2e    # e2e — starts a dev server if one isn't up

npm run verify      # typecheck + lint + unit
npm run verify:all  # ...+ integration + e2e. Run this before calling anything done.
```

## The rules

**No seed data. Ever.** Not a `seed.sql`, not a fixtures file, not a shared "test workspace". Every test creates exactly what it needs and tears it down. A test that depends on data it didn't create passes for the wrong reason and fails for one you can't reproduce.

Consequence: tests build their data **through the real API and the real schema**, not by side-loading. That's deliberate — it means the write path is under test too, and a test can't set up a state the app itself couldn't produce.

**Nothing is pushed.** No CI, no deploy. Local only, until every feature has been driven by hand.

The harness **refuses to run against anything but localhost**. It holds the service-role key and deletes users; pointed at prod that's a data-loss event, and the only thing between the two is an environment variable.

## Why integration tests carry the weight

**RLS is code nothing else can check.** TypeScript can't see it. Unit tests can't reach it. A policy that's subtly too permissive looks *exactly* like one that works — right up until someone reads a row they shouldn't. The only proof is a second user who tries and fails.

Note the shape of the base-delete test in `schema.test.ts`. When RLS blocks a `DELETE`, PostgREST **doesn't error** — it deletes zero rows and reports success. So the assertion is *"the row still exists"*, not *"we got an error"*. A test written the obvious way passes while the data quietly walks out.

## Coverage by phase

| Phase | Area | File |
|---|---|---|
| 0 | Auth bypass, env fail-fast | `unit/supabase-env.test.ts` |
| 0 | Type inference | `unit/inference.test.ts` |
| 0 | CSV / JSON parsing, flatten | `unit/import.test.ts` |
| 0 | Per-type value validation | `unit/validate.test.ts` |
| 1a | Schema, RLS, roles, constraints, cascades, fractional order | `integration/schema.test.ts` |
| 1b | Query engine: operators, date windows, filter trees, keyset pagination, **injection** | `integration/query-engine.test.ts` |
| 1b | Query spec wire format | `unit/query-spec-schema.test.ts` |
| 1c | Field keys, role ladder, operator gating | `unit/field-keys.test.ts` |
| 1c | **Concurrent cell edits**, fractional move, cross-table write | `integration/writes.test.ts` |
| 1d | View config persistence, rename-safety | `integration/view-config.test.ts` |
| 2 | Links, lookups, rollups, formulas — and that they're **filterable** | `integration/relational.test.ts` |
| 2 | Formula parser: precedence, arity, rename-safety | `unit/formula.test.ts` |
| 3 | Command stack, undo/redo | `unit/commands.test.ts` |
| 3 | TSV round-trip, fill series | `unit/clipboard.test.ts` |
| 3 | Keyboard, range select, undo, fill, resize | `e2e/grid-keyboard.spec.ts` |
| 4 | **Public sharing — adversarial** | `integration/sharing.test.ts` |
| 5 | Comments, history, invites | `integration/collaboration.test.ts` |
| 6 | **API tokens — adversarial** | `integration/api-tokens.test.ts` |
| 6 | Webhooks: when we fire, and who may forge one | `integration/webhooks.test.ts` |
| 6 | Attachment reference counting, storage paths | `integration/attachments.test.ts` |
| 6 | Signing, replay, SSRF, backoff | `unit/webhook-crypto.test.ts` |
| 6 | REST query string → spec | `unit/rest-query.test.ts` |
| — | Import → filter → sort → edit | `e2e/table.spec.ts` |

## The tests that matter most

If you only read four:

**`integration/sharing.test.ts`** — the only surface an anonymous stranger can reach. It tries to read a hidden column, *filter* by a hidden column (a blind oracle: never see the value, binary-search it off the row count), widen the view's filter, write to a shared grid, and POST `{"fld_salary": 999999}` at a contact form that doesn't show it.

**`integration/api-tokens.test.ts`** — the credential most likely to end up in a public repo, a CI log, or a screenshot. So the question is never "does it work" but "what does it get you when it leaks". The one that carries the design: *a write token stops writing the moment its owner is demoted* — not revoked, not expired, still carrying the scope, and no longer able to write, because the role is recomputed from live membership on every call. It's the test that fails if anyone ever "optimises" the role onto the token row.

**`integration/writes.test.ts`** — two patches to different cells of the same row, fired together. The old code read-modify-wrote in JavaScript and silently ate one of them. No error, no conflict; the edit just vanished after the person had watched it appear.

**`unit/commands.test.ts`** — undo. Drives the whole stack against a fake, because commands take their context as an argument rather than importing `fetch`. The interesting ones: a failed command never goes on the stack, and redo *restores* rather than re-inserting, so ids stay stable.

## Writing a test

- Name it after the behaviour, not the function: *"rejects a currency field given a non-numeric value"*.
- One assertion's worth of intent per test. If you need "and", you probably need two tests.
- When you fix a bug, the regression test lands **in the same commit**, and it must **fail on the old code**. If it passes on the old code, it isn't testing the bug.
