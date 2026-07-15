# Environments

## Where you are right now — read this first

**Do not touch production. Not yet.**

Everything in the "Cutover" section below is for *after* Phase 1 is built and tested locally. Running `supabase db push` today would only push the current `datasets` schema — the one Phase 1 is about to replace. Pointless, and it would burn the one free reset you have.

Today, the entire job is: **get a local stack running and confirm the app still works after the Phase 0 teardown.**

```bash
# 1. Prerequisites
brew install supabase/tap/supabase
#    Docker Desktop must be installed and RUNNING.

# 2. Start the local stack
supabase start                # first run pulls images; takes a few minutes
supabase status               # prints the API URL and anon key — copy them

# 3. Point .env.local at LOCAL, not prod
#    Replace the hosted URL/key that are in there now:
#      NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#      NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
#    Delete NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY if it's still there.

# 4. Build the schema from zero
supabase db reset             # replays all 4 migrations

# 5. Confirm nothing broke in the teardown
npm run verify                # typecheck + lint + 21 unit tests
npm run dev                   # sign up, import a CSV, poke at the grid
```

Step 3 is the one that matters most. `.env.local` currently points at the **hosted project**, which means `npm run dev` and `npm run test:e2e` are writing into production right now.

That's it. Nothing else. Prod stays untouched until the rebuild is done.

---

## The three of them

| | Where it lives | Where its schema comes from | Where its secrets live |
|---|---|---|---|
| **Local** | Docker, via `supabase start` | `supabase db reset` — replays every migration from zero | `.env.local` (gitignored) |
| **Prod** | the hosted Supabase project | `supabase db push` — applies migrations from git | Vercel → Project → Environment Variables |
| **App** | Vercel | — | same |

There is no staging. There doesn't need to be one yet, and adding it before there's traffic is ceremony. If prod ever has users, add it.

## The one rule

> **Production schema changes only ever happen through a migration file in git.**

No more SQL pasted into the Studio editor. Not "just this once," not "it's only an index."

This is not a style preference. The hosted project's migration ledger is empty *precisely because* its schema was applied by hand — Postgres has the tables, `schema_migrations` has never heard of them, and `db push` therefore cannot work at all until we reset. One hand-applied statement puts you straight back into that state, and next time there may be data in the way.

If you need to poke at prod to *look* at something, the SQL editor is fine. The moment you `create`, `alter`, or `drop`, it goes in a migration.

## `.env.local` points at LOCAL. Always.

Right now it points at the hosted project, which means `npm run dev` and — worse — `npm run test:e2e` write into production. The e2e suite creates and deletes records. Point it at the local stack:

```bash
supabase start
supabase status          # prints API URL + anon key
```

```dotenv
# .env.local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key from `supabase status`>
```

Production credentials live in **Vercel only**. They should not exist on your laptop. The failure mode you're avoiding is a stray `supabase db reset` or a test run against the wrong URL, and the way you avoid it is by making the wrong URL unavailable.

## Cutover — LATER. Not today.

> **Prerequisite: Phase 1 is built, and every feature has been tested locally.**
> Until then, skip this section entirely. Doing it early pushes a schema that's
> about to be thrown away, and spends the free reset you only get once.

```bash
# 1. Wipe the hosted DB. Dashboard → Settings → General → Reset database.
#    (It holds nothing precious. This is the last moment that's true for free.)

# 2. Give the CLI the project
supabase login
supabase link --project-ref jucalmdvwnmotzagorui

# 3. Apply the full chain from zero. The ledger is now honest.
supabase db push

# 4. Vercel → Environment Variables:
#      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
#      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SYNC_JOB_SECRET, CRON_SECRET
```

After this, prod has a real migration history and every future change is one command.

## The loop, every time after

```bash
supabase migration new add_links      # 1. new file
#    ...write the SQL...
supabase db reset                     # 2. replay from zero, locally
npm run verify && npm run test:e2e    # 3. prove it
git commit && git push                # 4. the schema is now in version control
supabase db push                      # 5. prod schema
vercel --prod                         # 6. prod code
```

### Steps 5 and 6 are in that order, and the gap between them matters

For the seconds or minutes between "schema is live" and "code is live", **production is running the old code against the new schema.** So every migration must be backward-compatible with the code that's currently deployed:

- ✅ Add a table. Add a nullable column. Add an index.
- ❌ Drop a column the running code still selects. Rename a column. Add a `not null` without a default.

When you genuinely need a breaking change, it's two deploys, not one — **expand, then contract**:

1. **Expand** — add the new column/table. Deploy code that writes to both old and new, reads from old.
2. **Backfill** — migrate the existing rows.
3. **Cut over** — deploy code that reads from new.
4. **Contract** — a *later* migration drops the old column.

Each step is independently safe to roll back. This is tedious and it is the whole game once people are using the thing.

## Which is exactly why Phase 1 happens now

Phase 1 re-parents `datasets` → `bases`/`tables`, retypes `records.order`, and rewrites every RLS policy. Under expand/contract that's weeks of dual-writing and backfills.

Today it's one migration and a `db reset`, because nobody's data is in there.

**That option expires the day you get a user.** It is the single strongest argument for doing the schema before the launch rather than after it.
