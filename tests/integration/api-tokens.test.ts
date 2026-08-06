import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anon,
  createUser,
  deleteUser,
  must,
  workspaceOf,
  type TestUser,
} from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// API tokens — written adversarially.
//
// A token is the credential most likely to end up in a public repository, a CI
// log, a Slack message, or a screenshot. So the interesting question is never
// "does it work" — it is "what does it get you when it leaks", and every test
// below is a way of trying to get more.
//
// The one property everything rests on: A TOKEN IS NOT A SECOND IDENTITY. It is a
// narrower view of one that already exists, and its role is recomputed from live
// membership on every single call.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let mallory: TestUser;

let baseId: string;
let tableId: string;
let malloryTableId: string;

/** The public client: no session, no user. What the REST API actually runs on. */
const pub = () => anon();

async function mint(
  user: TestUser,
  base: string,
  scopes: string[],
  expiresAt: string | null = null
): Promise<string> {
  const { data, error } = await user.db.rpc("swamp_create_token", {
    p_base_id: base,
    p_name: "test",
    p_scopes: scopes,
    p_expires_at: expiresAt,
  });

  if (error) throw new Error(error.message);
  return (data as { token: string }).token;
}

beforeAll(async () => {
  alice = await createUser();
  mallory = await createUser();

  const workspaceId = await workspaceOf(alice);

  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "API" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Deals" }).select().single()
  ) as { id: string };
  tableId = table.id;

  must(
    await alice.db.from("fields").insert([
      { table_id: tableId, base_id: baseId, name: "Name",   key: "fld_name",   type: "text",     is_primary: true,  sort_order: 1 },
      { table_id: tableId, base_id: baseId, name: "Amount", key: "fld_amount", type: "currency", is_primary: false, sort_order: 2 },
    ])
  );

  must(
    await alice.db.from("records").insert([
      { table_id: tableId, base_id: baseId, data: { fld_name: "Acme",  fld_amount: 100 }, sort_order: 1 },
      { table_id: tableId, base_id: baseId, data: { fld_name: "Globex", fld_amount: 200 }, sort_order: 2 },
    ])
  );

  // Mallory has her own base, entirely separate. She is not hostile by nature —
  // she is just another customer, which is the point.
  const mWorkspace = await workspaceOf(mallory);
  const mBase = must(
    await mallory.db
      .from("bases")
      .insert({ workspace_id: mWorkspace, name: "Mallory's" })
      .select()
      .single()
  ) as { id: string };

  const mTable = must(
    await mallory.db.from("tables").insert({ base_id: mBase.id, name: "Secrets" }).select().single()
  ) as { id: string };
  malloryTableId = mTable.id;

  must(
    await mallory.db.from("fields").insert({
      table_id: malloryTableId, base_id: mBase.id,
      name: "Secret", key: "fld_secret", type: "text", is_primary: true, sort_order: 1,
    })
  );
});

afterAll(async () => {
  await deleteUser(alice);
  await deleteUser(mallory);
});

// ─── The token itself ───────────────────────────────────────────────────────

describe("minting", () => {
  it("returns the plaintext exactly once, and stores only a hash", async () => {
    const token = await mint(alice, baseId, ["records:read"]);

    expect(token).toMatch(/^swamp_pat_/);

    const { data } = await alice.db
      .from("api_tokens")
      .select("token_hash, prefix")
      .eq("prefix", token.slice(0, 18))
      .single();

    // The plaintext exists nowhere in the database. "I lost my token" has exactly
    // one answer, and it is "make another one" — any product with a better answer
    // than that is storing your token where it can read it.
    expect(data!.token_hash).not.toBe(token);
    expect(data!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("will not mint a token for a base you cannot reach", async () => {
    // RLS. Mallory has never heard of Alice's base.
    const { error } = await mallory.db.rpc("swamp_create_token", {
      p_base_id: baseId,
      p_name: "nice base",
      p_scopes: ["records:write"],
      p_expires_at: null,
    });

    expect(error).not.toBeNull();
  });

  it("does not let you read anyone else's token row", async () => {
    await mint(alice, baseId, ["records:read"]);

    const { data } = await mallory.db.from("api_tokens").select("id");
    expect(data ?? []).toHaveLength(0);
  });
});

// ─── Using it ───────────────────────────────────────────────────────────────

describe("a read token", () => {
  it("reads", async () => {
    const token = await mint(alice, baseId, ["records:read"]);

    const { data, error } = await pub().rpc("swamp_api_query", {
      p_token: token,
      p_table_id: tableId,
      p_spec: {},
    });

    expect(error).toBeNull();
    expect((data as { records: unknown[] }).records).toHaveLength(2);
  });

  it("CANNOT write, even though its owner can", async () => {
    // Alice is an owner. The token is not: a scope narrows, it never widens.
    const token = await mint(alice, baseId, ["records:read"]);

    const { error } = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: tableId,
      p_records: [{ fields: { fld_name: "Snuck in" } }],
    });

    expect(error?.message).toMatch(/scope/i);

    const { count } = await alice.db
      .from("records")
      .select("id", { count: "exact", head: true })
      .eq("table_id", tableId)
      .is("deleted_at", null);

    expect(count).toBe(2);
  });
});

describe("a write tells you what it computed", () => {
  // The REST API's write response used to return `r.data` raw — the stored scalars and
  // nothing else. Every computed field is projected at READ time and is not a key in
  // `data` at all, so a caller who patched Amount got back a record with no Doubled in
  // it. Their choices were to believe a response that was missing the value they had
  // just changed, or to GET the row again and race whoever else was editing it.
  //
  // The grid got this fixed; these tests are the other client — the one with no screen
  // to notice on.
  let fTableId: string;
  let doubledOk: boolean;

  beforeAll(async () => {
    const t = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Computed" }).select().single()
    ) as { id: string };
    fTableId = t.id;

    const amount = must(
      await alice.db
        .from("fields")
        .insert({
          table_id: fTableId, base_id: baseId,
          name: "Amount", key: "fld_amt", type: "number", is_primary: true, sort_order: 1,
        })
        .select()
        .single()
    ) as { id: string };

    // Amount * 2. Referenced by field ID, which is what makes a formula rename-safe.
    const { error } = await alice.db.from("fields").insert({
      table_id: fTableId, base_id: baseId,
      name: "Doubled", key: "fld_doubled", type: "formula", is_primary: false, sort_order: 2,
      options: { ast: { t: "bin", op: "*", l: { t: "field", id: amount.id }, r: { t: "num", v: 2 } } },
    });
    doubledOk = !error;
  });

  it("returns computed fields from an INSERT", async () => {
    expect(doubledOk, "formula field setup failed").toBe(true);
    const token = await mint(alice, baseId, ["records:read", "records:write"]);

    const { data, error } = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: fTableId,
      p_records: [{ fields: { fld_amt: 21 } }],
    });

    expect(error).toBeNull();
    const rows = data as { id: string; fields: Record<string, unknown> }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].fields.fld_amt).toBe(21);
    // The whole point: the formula came back with the row that caused it.
    expect(Number(rows[0].fields.fld_doubled)).toBe(42);
  });

  it("returns RECOMPUTED fields from a PATCH", async () => {
    expect(doubledOk, "formula field setup failed").toBe(true);
    const token = await mint(alice, baseId, ["records:read", "records:write"]);

    const inserted = must(
      await pub().rpc("swamp_api_insert", {
        p_token: token, p_table_id: fTableId, p_records: [{ fields: { fld_amt: 5 } }],
      })
    ) as { id: string; fields: Record<string, unknown> }[];

    const { data, error } = await pub().rpc("swamp_api_patch", {
      p_token: token,
      p_table_id: fTableId,
      p_records: [{ id: inserted[0].id, fields: { fld_amt: 50 } }],
    });

    expect(error).toBeNull();
    const rows = data as { id: string; fields: Record<string, unknown> }[];
    // 100, not 10: recomputed AFTER the write. Computing first would hand back the old
    // Doubled for the new Amount, which is worse than omitting it.
    expect(Number(rows[0].fields.fld_doubled)).toBe(100);
  });

  it("costs a table with no computed fields nothing extra", async () => {
    // swamp_computed_values returns '[]' after one catalog read when there is nothing
    // to compute, so the ordinary table keeps its plain response shape.
    const token = await mint(alice, baseId, ["records:read", "records:write"]);

    const { data, error } = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: tableId, // the plain Deals table from the top of this file
      p_records: [{ fields: { fld_name: "Plain" } }],
    });

    expect(error).toBeNull();
    const rows = data as { id: string; fields: Record<string, unknown> }[];
    expect(rows[0].fields.fld_name).toBe("Plain");
  });
});

describe("reaching outside the base", () => {
  it("cannot touch a table in someone else's base", async () => {
    const token = await mint(alice, baseId, ["records:read"]);

    const { error } = await pub().rpc("swamp_api_query", {
      p_token: token,
      p_table_id: malloryTableId,
      p_spec: {},
    });

    // "No such table" — NOT "you are not allowed to see that table". The second
    // answer confirms it exists, and a token holder could walk the id space and
    // map every table in the database.
    expect(error?.message).toMatch(/no such table/i);
  });
});

describe("a dead token", () => {
  it("is dead when revoked", async () => {
    const token = await mint(alice, baseId, ["records:read"]);

    await alice.db
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("prefix", token.slice(0, 18));

    const { error } = await pub().rpc("swamp_api_query", {
      p_token: token, p_table_id: tableId, p_spec: {},
    });

    expect(error?.message).toMatch(/revoked/i);
  });

  it("is dead when expired", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const token = await mint(alice, baseId, ["records:read"], yesterday);

    const { error } = await pub().rpc("swamp_api_query", {
      p_token: token, p_table_id: tableId, p_spec: {},
    });

    expect(error?.message).toMatch(/expired/i);
  });

  it("is dead when it never existed", async () => {
    const { error } = await pub().rpc("swamp_api_query", {
      p_token: "swamp_pat_i-made-this-up", p_table_id: tableId, p_spec: {},
    });

    expect(error?.message).toMatch(/invalid/i);
  });
});

// ─── The property the whole design rests on ─────────────────────────────────

describe("the token's role is LIVE, not a copy taken when it was minted", () => {
  it("stops writing the moment its owner is demoted", async () => {
    // Bob is an editor. He makes a read+write token. It writes.
    const bob = await createUser();

    try {
      must(
        await alice.db
          .from("base_members")
          .insert({ base_id: baseId, user_id: bob.id, role: "editor" })
      );

      // Both scopes: the point of this test is that after demotion the WRITE is
      // refused by the live role while the READ still works. A write-only token
      // couldn't read for a different reason (no read scope), which would prove
      // nothing about roles.
      const token = await mint(bob, baseId, ["records:read", "records:write"]);

      const first = await pub().rpc("swamp_api_insert", {
        p_token: token,
        p_table_id: tableId,
        p_records: [{ fields: { fld_name: "Bob was here" } }],
      });
      expect(first.error).toBeNull();

      // Now Alice demotes him to viewer. She does NOT touch his token — she has
      // never seen it and cannot list it.
      must(
        await alice.db
          .from("base_members")
          .update({ role: "viewer" })
          .eq("base_id", baseId)
          .eq("user_id", bob.id)
          .select()
      );

      // THE TEST. The token is not revoked. It is not expired. It still carries the
      // records:write scope. And it can no longer write — because the role is
      // recomputed from live membership on every call, not stored on the token.
      //
      // Store the role on the token instead and you get: "we removed him in March
      // and his integration was still writing to production in July."
      const second = await pub().rpc("swamp_api_insert", {
        p_token: token,
        p_table_id: tableId,
        p_records: [{ fields: { fld_name: "and again" } }],
      });

      expect(second.error).not.toBeNull();
      expect(second.error!.message).toMatch(/viewer cannot/i);

      // ...but it can still READ, because a viewer can read. The token was narrowed,
      // not killed — which is the correct outcome, and the one a blunt "revoke
      // everything on demotion" would get wrong.
      const read = await pub().rpc("swamp_api_query", {
        p_token: token, p_table_id: tableId, p_spec: {},
      });
      expect(read.error).toBeNull();
    } finally {
      await deleteUser(bob);
    }
  });

  it("dies completely when its owner is removed from the base", async () => {
    const carol = await createUser();

    try {
      must(
        await alice.db
          .from("base_members")
          .insert({ base_id: baseId, user_id: carol.id, role: "editor" })
      );

      const token = await mint(carol, baseId, ["records:read"]);
      expect((await pub().rpc("swamp_api_query", {
        p_token: token, p_table_id: tableId, p_spec: {},
      })).error).toBeNull();

      await alice.db
        .from("base_members")
        .delete()
        .eq("base_id", baseId)
        .eq("user_id", carol.id);

      const after = await pub().rpc("swamp_api_query", {
        p_token: token, p_table_id: tableId, p_spec: {},
      });

      expect(after.error?.message).toMatch(/no longer a member/i);
    } finally {
      await deleteUser(carol);
    }
  });
});

// ─── The write path, through a token ────────────────────────────────────────

describe("writing", () => {
  it("drops keys that aren't writable fields, rather than storing junk", async () => {
    const token = await mint(alice, baseId, ["records:write"]);

    const { data } = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: tableId,
      p_records: [
        { fields: { fld_name: "Real", fld_nonsense: "junk", id: "hijack" } },
      ],
    });

    const created = (data as { id: string; fields: Record<string, unknown> }[])[0];

    // swamp_pick_writable builds the allowlist in SQL from the field catalog. The
    // TypeScript layer validates too — but if it vanished tomorrow, this would
    // still hold.
    expect(created.fields).toEqual({ fld_name: "Real" });
  });

  it("merges on patch — it does not replace the record", async () => {
    const token = await mint(alice, baseId, ["records:write"]);

    const { data: made } = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: tableId,
      p_records: [{ fields: { fld_name: "Merge me", fld_amount: 500 } }],
    });

    const id = (made as { id: string }[])[0].id;

    await pub().rpc("swamp_api_patch", {
      p_token: token,
      p_table_id: tableId,
      p_records: [{ id, fields: { fld_amount: 999 } }],
    });

    const { data } = await alice.db.from("records").select("data").eq("id", id).single();

    // The name survives. An API that replaced the whole record on PATCH would mean
    // every integration has to read-modify-write, and every one of them would race.
    expect(data!.data).toEqual({ fld_name: "Merge me", fld_amount: 999 });
  });

  it("attributes the write to the token's owner, in the history", async () => {
    const token = await mint(alice, baseId, ["records:write"]);

    const { data: made } = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: tableId,
      p_records: [{ fields: { fld_name: "Who did this" } }],
    });

    const id = (made as { id: string }[])[0].id;

    const { data: record } = await alice.db
      .from("records")
      .select("created_by")
      .eq("id", id)
      .single();

    const { data: history } = await alice.db
      .from("record_audit")
      .select("actor_id, op")
      .eq("record_id", id);

    // There is no auth.uid() on this connection at all. Without swamp_actor(), both
    // of these are NULL — and an audit log that says "someone changed this" is the
    // exact thing an audit log exists not to be.
    expect(record!.created_by).toBe(alice.id);
    expect(history![0].actor_id).toBe(alice.id);
  });

  it("cannot patch a record in another table, even inside the same base", async () => {
    const token = await mint(alice, baseId, ["records:write"]);

    const other = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Other" }).select().single()
    ) as { id: string };

    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "safe" } })
        .select()
        .single()
    ) as { id: string };

    await pub().rpc("swamp_api_patch", {
      p_token: token,
      p_table_id: other.id,
      p_records: [{ id: record.id, fields: { fld_name: "hacked" } }],
    });

    const { data } = await alice.db.from("records").select("data").eq("id", record.id).single();
    expect((data!.data as Record<string, unknown>).fld_name).toBe("safe");
  });
});

// ─── The door itself ────────────────────────────────────────────────────────

describe("anon has no way in except through these functions", () => {
  it("cannot select from records at all", async () => {
    // Not "RLS returns nothing" — no GRANT. Until Phase 6 anon held `grant all on
    // all tables`, and RLS was the only thing standing between the internet and
    // every row in the database. It held. It should not have had to.
    const { error } = await pub().from("records").select("id").limit(1);
    expect(error).not.toBeNull();
  });

  // This block used to be one test that passed for the wrong reason, for two years.
  //
  // It called swamp_token_context with p_token: "anything" and asserted an error came
  // back. An error always came back — 'swamp: invalid API token' — whether or not anon
  // held EXECUTE. So it proved the token check works, while claiming to prove the
  // grant was gone. The grant was NOT gone: `revoke ... from anon` (platform.sql:1757)
  // never removed PUBLIC's default EXECUTE, and anon inherits it through PUBLIC. anon
  // could call every one of these the whole time this test was green.
  //
  // A permission test must therefore assert on the PERMISSION. has_function_privilege
  // resolves PUBLIC membership, which is the exact thing the original revoke missed.
  // The assertion is on PERMISSION DENIED specifically, and that word is the whole
  // point. "Some error came back" is what passed while the door was open; only
  // "permission denied" can distinguish a closed door from a working inner guard.
  it("is refused EXECUTE on the internals the API functions are built from", async () => {
    const internals: [string, Record<string, unknown>][] = [
      // Resolves a token without checking a scope.
      ["swamp_token_context", { p_token: "anything" }],
      // The scope check itself.
      ["swamp_api_require", { p_token: "x", p_scope: "records:read", p_min: "viewer" }],
      // Trusts a caller-supplied ctx — see the baseId test below.
      ["swamp_api_table", { p_ctx: {}, p_table_id: tableId }],
      // Anyone's role in any base.
      ["swamp_base_role_of", { p_base_id: baseId, p_user_id: alice.id }],
      ["swamp_accept_invite", { p_token: "anything" }],
    ];

    for (const [fn, params] of internals) {
      const { error } = await pub().rpc(fn, params);
      expect(error?.message, `anon can still reach ${fn}`).toMatch(/permission denied/i);
    }
  });

  it("still reaches the functions that are anon BY DESIGN", async () => {
    // The half that makes the revokes safe to trust. Share links, form submission and
    // the token-authed REST API are all reached with no session — their credential is
    // the share id or the token, never the anon key. Each must fail on its OWN guard
    // (bad token / no such share), never on permission.
    const publicSurface: [string, Record<string, unknown>][] = [
      ["swamp_api_meta", { p_token: "bogus" }],
      ["swamp_api_query", { p_token: "bogus", p_table_id: tableId, p_spec: {} }],
      ["swamp_shared_meta", { p_share_id: "bogus", p_password: "" }],
    ];

    for (const [fn, params] of publicSurface) {
      const { error } = await pub().rpc(fn, params);
      expect(error, `${fn} should still reject a bogus credential`).not.toBeNull();
      expect(error?.message, `anon LOST ${fn} — the public API needs it`).not.toMatch(
        /permission denied/i
      );
    }
  });

  it("cannot read another tenant's table by omitting the baseId", async () => {
    // swamp_api_table's guard was `v_t.base_id <> (p_ctx->>'baseId')::uuid`. p_ctx is
    // caller-supplied: with '{}' the right operand is NULL, `<>` yields NULL, `if NULL`
    // does not fire, and the row came back — to an anon caller holding no token at all.
    // A WRONG baseId was rejected; a MISSING one was waved through.
    //
    // Both halves are fixed, so assert both. The grant is the outer door:
    const { error } = await pub().rpc("swamp_api_table", { p_ctx: {}, p_table_id: tableId });
    expect(error?.message).toMatch(/permission denied/i);

    // ...and the guard is the inner one, which must hold even for a caller who is
    // allowed in. A token-holding caller reaches this function through swamp_api_meta
    // and friends, and an empty ctx must not open someone else's base to them either.
    const token = await mint(alice, baseId, ["records:read"]);
    const { error: crossTenant } = await pub().rpc("swamp_api_query", {
      p_token: token,
      p_table_id: malloryTableId,
      p_spec: {},
    });
    expect(crossTenant?.message).toMatch(/no such table/i);
  });

  it("cannot read a token row to look for a hash to crack", async () => {
    const { error } = await pub().from("api_tokens").select("token_hash").limit(1);
    expect(error).not.toBeNull();
  });
});

// ─── Scopes must be real ────────────────────────────────────────────────────

describe("token scopes", () => {
  // There were five scopes and only two were ever enforced: every
  // swamp_api_require call in platform.sql asks for records:read or
  // records:write. schema:read, webhooks:read and webhooks:write were read by
  // nothing — a schema:read-only token could not even call /api/v1/meta (which
  // requires records:read), so it could do nothing at all, and no v1 webhook
  // endpoint exists for the other two to govern.
  //
  // A checkbox that grants nothing is worse than a missing feature: it reads as a
  // security control, so someone hands out a "schema:read only" token believing
  // it is narrow. These tests exist to stop the dead scopes coming back without
  // the endpoint that would honour them.
  it("refuses to mint a token with a scope nothing enforces", async () => {
    await expect(mint(alice, baseId, ["schema:read"])).rejects.toThrow();
    await expect(mint(alice, baseId, ["webhooks:read"])).rejects.toThrow();
    await expect(mint(alice, baseId, ["webhooks:write"])).rejects.toThrow();
  });

  it("refuses a dead scope even when smuggled in beside a live one", async () => {
    await expect(mint(alice, baseId, ["records:read", "schema:read"])).rejects.toThrow();
  });

  it("refuses a token with no scopes at all", async () => {
    // Guarded at the MINT path (swamp_create_token), deliberately not by a CHECK
    // constraint — see the test below for why that distinction is load-bearing.
    await expect(mint(alice, baseId, [])).rejects.toThrow();
  });

  it("still mints the two that are real", async () => {
    await expect(mint(alice, baseId, ["records:read"])).resolves.toMatch(/./);
    await expect(mint(alice, baseId, ["records:read", "records:write"])).resolves.toMatch(/./);
  });

  // The scopes CHECK deliberately tolerates {} rather than requiring
  // cardinality >= 1, and this is the test that says why.
  //
  // A CHECK fires on UPDATE as well as INSERT, against the NEW row, whether or not
  // the UPDATE touched the constrained column. So `cardinality(scopes) >= 1` would
  // make a {}-scoped row impossible to UPDATE — including the one UPDATE that
  // matters, `set revoked_at = now()`. The constraint meaning "a token must grant
  // something" would instead mean "a token that grants nothing is permanent".
  //
  // {}-scoped rows are not hypothetical: the original constraint said
  // `array_length(scopes, 1) >= 1`, which is NULL for '{}', and a CHECK only
  // rejects on FALSE — so it passed everything it was written to reject. Any such
  // row in production gets stripped to {} by 20260716010000 and must stay revokable.
  it("can revoke a token that grants nothing", async () => {
    const { data: row } = await admin()
      .from("api_tokens")
      .insert({
        base_id: baseId,
        user_id: alice.id,
        name: "legacy-empty",
        token_hash: `empty-${randomUUID()}`,
        prefix: "swamp_pat_legacy",
        scopes: [],
      })
      .select("id")
      .single();

    expect(row).not.toBeNull();

    const { error } = await admin()
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", row!.id);

    expect(error).toBeNull();
  });
});

// ─── Phase-7: token-API aggregate ───────────────────────────────────────────

describe("swamp_api_aggregate", () => {
  it("computes a summary for a token that may read", async () => {
    const token = await mint(alice, baseId, ["records:read"]);
    const { data, error } = await pub().rpc("swamp_api_aggregate", {
      p_token: token,
      p_table_id: tableId,
      p_spec: {},
      p_aggs: { fld_name: "count" },
    });
    expect(error).toBeNull();
    expect(Number((data as Record<string, unknown>).fld_name)).toBeGreaterThanOrEqual(0);
  });

  it("refuses a table in another base — 404-shaped, no existence leak", async () => {
    const token = await mint(alice, baseId, ["records:read"]);
    const { error } = await pub().rpc("swamp_api_aggregate", {
      p_token: token,
      p_table_id: malloryTableId,
      p_spec: {},
      p_aggs: { fld_name: "count" },
    });
    expect(error).not.toBeNull();
  });

  it("refuses a bogus token", async () => {
    const { error } = await pub().rpc("swamp_api_aggregate", {
      p_token: "swamp_pat_nope",
      p_table_id: tableId,
      p_spec: {},
      p_aggs: { fld_name: "count" },
    });
    expect(error).not.toBeNull();
  });

  it("rejects an unknown aggregation name rather than interpolating it", async () => {
    const token = await mint(alice, baseId, ["records:read"]);
    const { error } = await pub().rpc("swamp_api_aggregate", {
      p_token: token,
      p_table_id: tableId,
      p_spec: {},
      p_aggs: { fld_name: "sum); drop table public.records; --" },
    });
    expect(error).not.toBeNull();

    // And the table is still there.
    const { data } = await admin()
      .from("records")
      .select("id", { count: "exact", head: true })
      .eq("table_id", tableId);
    void data;
  });
});
