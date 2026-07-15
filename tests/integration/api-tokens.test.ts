import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

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

  it("cannot call the internals the API functions are built from", async () => {
    // swamp_token_context resolves a token without checking a scope. Reachable
    // directly, it would be a way to skip the check the API functions exist to do.
    const { error } = await pub().rpc("swamp_token_context", { p_token: "anything" });
    expect(error).not.toBeNull();
  });

  it("cannot read a token row to look for a hash to crack", async () => {
    const { error } = await pub().from("api_tokens").select("token_hash").limit(1);
    expect(error).not.toBeNull();
  });
});
