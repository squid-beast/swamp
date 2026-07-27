import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ════════════════════════════════════════════════════════════════════════════
// What can the internet execute?
//
// One question, asked of the whole schema at once, because asking it per-function is
// how it went unanswered for two years.
//
// `revoke all on all routines in schema public from anon` (platform.sql:1757) is a
// no-op: Postgres grants EXECUTE to PUBLIC on every `create function`, anon is a
// member of PUBLIC, and revoking from anon leaves the PUBLIC entry — which is
// sufficient on its own. The migration ran, succeeded, changed the ACL, and left ~59
// functions reachable by anyone with the publishable key, directly underneath a
// comment describing the opposite.
//
// 20260716090000_anon_grants.sql closes the ones that were reachable AND interesting.
// It cannot stop the next one: every `create function` still hands anon EXECUTE
// through PUBLIC, and no `alter default privileges` incantation prevents it (three
// were tried and measured — see the note in that migration).
//
// So this test is the guard. Add a function, forget
//
//     revoke all on function public.your_fn(args) from public, anon;
//
// and this goes red naming your function. That is the only thing standing between the
// convention and the next silent hole.
//
// ── Why a raw pg client ──
//
// supabase-js speaks PostgREST, which cannot read pg_proc, and the question here is
// specifically "what does the catalog say" rather than "what happens when I call it".
// A behavioural probe cannot enumerate — it can only check functions you already
// thought of, which is exactly the blind spot that let this happen.
// ════════════════════════════════════════════════════════════════════════════

const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * The complete set of functions anon may execute. Nothing else, ever.
 *
 * Each is a deliberate public edge of the product, and each has a credential that is
 * NOT the anon key — a 128-bit share id, or an API token. The anon key is how you
 * reach the function; it is not what authorises you inside it.
 *
 * Adding to this list is a security decision. It should be hard to do by accident,
 * which is the point of writing it down here rather than deriving it.
 */
const ALLOWED = new Set([
  // Public share links. The share_id is the credential; a password gate may apply.
  "swamp_shared_meta",
  "swamp_shared_records",
  // Public form submission. Writes only to the form's own allow-listed fields.
  "swamp_submit_form",
  // The token-authed REST API. The token is the credential and is checked on entry;
  // its role is re-read from live membership on every call.
  "swamp_api_meta",
  "swamp_api_query",
  "swamp_api_get",
  "swamp_api_count",
  "swamp_api_insert",
  "swamp_api_patch",
  "swamp_api_delete",
  // Liveness probe. Takes nothing, touches nothing, returns 'ok'. A health check you
  // need credentials for is useless in the incident where you need it.
  "swamp_health",
  // Rate limiter for the public ingress. The form-submit and token-API routes run
  // on the anon client, so anon must reach it. It only counts against an opaque,
  // app-hashed bucket key and returns a boolean — it exposes and mutates no
  // product data, and cannot lower anyone else's limit without the exact hashed
  // key. See 20260717010000_leadgen_platform.sql.
  "swamp_rate_limit",
  // Upsert-by-field for the ingest route. Same authority as swamp_api_insert —
  // the token is checked on entry and its role re-read from live membership.
  "swamp_api_upsert",
  // Idempotency store for the ingest route, reached only on the anon client. Both
  // touch an app-hashed opaque key and expose no product data; claim returns a
  // status/replayed-body, finish returns nothing. See 20260721000000_ingest_reliability.sql.
  "swamp_idempotency_claim",
  "swamp_idempotency_finish",
]);

let db: Client;

beforeAll(async () => {
  if (!/127\.0\.0\.1|localhost/.test(DB_URL)) {
    throw new Error(`[swamp] anon-surface test is pointed at ${DB_URL}. Local only.`);
  }
  db = new Client({ connectionString: DB_URL });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

describe("the anon surface", () => {
  it("is exactly the allowlist — nothing else in the schema is reachable", async () => {
    const { rows } = await db.query<{ fn: string; args: string }>(`
      select p.proname as fn,
             pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname like 'swamp\\_%'
         and has_function_privilege('anon', p.oid, 'execute')
       order by p.proname
    `);

    const unexpected = rows.filter((r) => !ALLOWED.has(r.fn));

    // The message matters as much as the assertion: whoever trips this is usually
    // someone who just added a function and has no idea what PUBLIC has to do with it.
    expect(
      unexpected.map((r) => `${r.fn}(${r.args})`),
      unexpected.length
        ? `\n\nanon can execute ${unexpected.length} function(s) it should not.\n` +
            `If you just added one, end its migration with:\n\n` +
            unexpected
              .map(
                (r) =>
                  `    revoke all on function public.${r.fn}(${r.args}) from public, anon;\n` +
                  `    grant execute on function public.${r.fn}(${r.args}) to authenticated;`
              )
              .join("\n\n") +
            `\n\n"from public" is the half that does the work — anon inherits EXECUTE\n` +
            `through PUBLIC, so "revoke ... from anon" alone is a no-op.\n` +
            `If anon SHOULD reach it, add it to ALLOWED in this file and say why.\n`
        : undefined
    ).toEqual([]);
  });

  it("still reaches everything the public product needs", async () => {
    // The other direction. Over-revoking breaks share links and the REST API silently
    // — silently, because the app itself never calls these as anon and no other test
    // would notice until a customer did.
    for (const fn of ALLOWED) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select bool_or(has_function_privilege('anon', p.oid, 'execute')) as ok
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [fn]
      );
      expect(rows[0]?.ok, `anon LOST ${fn} — the public product needs it`).toBe(true);
    }
  });

  it("cannot touch a table directly, whatever the functions allow", async () => {
    // The other half of the boundary. Until platform.sql anon held
    // `grant all on all tables`, and RLS was the only thing between the internet and
    // every row. It held. It should never have been the only thing that had to.
    const { rows } = await db.query<{ tbl: string }>(`
      select c.relname as tbl
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and has_table_privilege('anon', c.oid, 'select')
       order by c.relname
    `);

    expect(rows.map((r) => r.tbl)).toEqual([]);
  });
});
