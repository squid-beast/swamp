# Database migrations

## How this actually works

Two halves that must agree:

1. **Files** — `supabase/migrations/<timestamp>_<name>.sql`, applied in filename order.
2. **A ledger inside the database** — `supabase_migrations.schema_migrations`, one row per applied version.

`supabase db push` diffs them: *files the ledger hasn't seen → run them, record them.* The ledger is the source of truth for what's already applied. Nothing else is.

Two consequences people learn the hard way:

- **Deleting a migration file does not undo it.** The tables are still there. If you need something gone, write a migration that drops it. (`20260714000000_drop_task_boards.sql` exists because of exactly this.)
- **Editing an already-applied migration does nothing.** The ledger has seen that version; `db push` skips it. Migrations are append-only. Always write a new one.

## The loop

```bash
supabase start                       # local Postgres + auth (needs Docker)
supabase migration new add_links     # creates supabase/migrations/<ts>_add_links.sql
# ...write the SQL...
supabase db reset                    # wipe local, replay EVERY migration from scratch
npm run verify && npm run test:e2e   # prove it
```

`supabase db reset` is the important one. It replays the full chain on an empty database, which is the only way to know your migrations work *from zero* — the state a new environment is actually in. A migration that only works against your current local DB is a migration that will fail in production.

`db reset` applies migrations and nothing else. **If it ever starts inserting rows, someone has added a seed file. Delete it.** (See [tests/README.md](../tests/README.md).)

## Going to production

Nothing is pushed until the whole rebuild is tested locally end to end. When it is:

```bash
supabase login
supabase link --project-ref <ref>
supabase db push                     # applies only what the ledger hasn't seen
```

### One-time: the hosted project needs a clean baseline

The hosted project was built by pasting SQL into the Studio editor by hand. The CLI was never involved, so **its migration ledger is empty** — Postgres has the tables, but `schema_migrations` has no idea they exist. A `db push` would try to run `init` from the top and die on `relation "profiles" already exists`.

Since the project holds nothing precious, the clean fix is to reset it rather than reconcile it:

1. Supabase Dashboard → Settings → General → **Reset database** (or drop the `public` schema).
2. `supabase link --project-ref <ref>`
3. `supabase db push` — the full chain applies from zero and the ledger is honest from here on.

Do this **once**, before the Phase 1 schema lands. It's only this cheap while there's nothing to lose.

> If the project ever *does* hold data you care about, the escape hatch is
> `supabase migration repair --status applied <version>` — it marks a version as
> applied without running it, which is how you tell the ledger about SQL that was
> applied by hand. Use it to reconcile, not to skip a migration you didn't want.

## Rules

1. **Forward-only.** Never edit an applied migration. Write a new one.
2. **Every migration must survive `db reset`.** If it only works against your current database, it doesn't work.
3. **No seed data**, in migrations or anywhere else.
4. **Destructive changes get their own migration**, named for what they destroy. A `drop` hiding at the bottom of an `add_feature` migration is how people lose data.
5. **RLS on every new table, in the same migration that creates it.** A table that exists for even one deploy without RLS is a table that was public for one deploy.
6. Rehearse against a local `db reset` before it touches anything hosted. Every time.

## Phase 1 is not a normal migration

It re-parents `datasets` → `bases`/`tables`, changes `records.order` from `int` to `numeric`, and rewrites every RLS policy. On a database with real users that would need expand/contract — add the new tables, dual-write, backfill, cut over, drop the old.

It doesn't, so it won't. The plan is: **new schema in, old tables dropped, hosted project reset once.** That is a decision with an expiry date — it stops being available the moment someone else's data is in there.
