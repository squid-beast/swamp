import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Object management — renaming and deleting tables and bases.
//
// These operations had data-layer functions and no callers, so none of this code
// had ever run against a real Postgres. That is the interesting part: an unused
// write path looks identical to a working one until someone calls it.
//
// The load-bearing test here is "a creator cannot delete a base". The policies say
//
//     "bases: creator update"  →  creator
//     "bases: owner delete"    →  owner
//
// but deletion in this model is SOFT, and a soft delete is an UPDATE — so it goes
// through the *creator* policy and the owner rule guards only a hard DELETE that
// nothing calls. The `bases_guard_soft_delete` trigger closes that. RLS cannot
// express it, because the rule is about deleted_at CHANGING, and permissive
// policies OR together — you cannot narrow one by adding another.
//
// As ./schema.test.ts puts it: the only proof is a second user who tries and fails.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser; // owns the workspace, therefore owns the base
let bob: TestUser; // granted `creator` ON alice's base — the interesting role
let baseId: string;

async function makeBase(name = "Base") {
  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db.from("bases").insert({ workspace_id: workspaceId, name }).select().single()
  ) as { id: string };
  return base.id;
}

async function makeTable(baseId: string, name = "Table") {
  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name }).select().single()
  ) as { id: string };
  return table.id;
}

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

beforeEach(async () => {
  // Fresh base per test: several of these delete it.
  baseId = await makeBase();
  must(
    await alice.db.from("base_members").insert({ base_id: baseId, user_id: bob.id, role: "creator" })
  );
});

// ─── Tables ─────────────────────────────────────────────────────────────────

// NOTE: `createTable` is deliberately NOT tested here. This harness talks to
// Postgres directly, and createTable is a server-only function that needs Next's
// cookies() — so `makeTable` below inserts rows itself, and a test written against
// it would be testing the helper, not the code. That gap is real and it bit:
// createTable built a table with no fields, which the query engine refuses. The
// check for it lives in tests/e2e/object-management.spec.ts, where the actual route
// runs.

describe("table rename and delete", () => {
  it("a creator can rename a table", async () => {
    const tableId = await makeTable(baseId);

    const { error } = await bob.db.from("tables").update({ name: "Renamed" }).eq("id", tableId);
    expect(error).toBeNull();

    const { data } = await alice.db.from("tables").select("name").eq("id", tableId).single();
    expect(data!.name).toBe("Renamed");
  });

  it("an editor cannot — schema is creator work", async () => {
    const tableId = await makeTable(baseId);
    must(
      await alice.db
        .from("base_members")
        .update({ role: "editor" })
        .eq("base_id", baseId)
        .eq("user_id", bob.id)
    );

    await bob.db.from("tables").update({ name: "Nope" }).eq("id", tableId);

    // RLS makes this a no-op rather than an error: the row is simply not
    // updatable for him, so nothing matches. Assert the value, not the error.
    const { data } = await alice.db.from("tables").select("name").eq("id", tableId).single();
    expect(data!.name).toBe("Table");
  });

  it("deleting a table is soft — the row is tombstoned, not removed", async () => {
    const tableId = await makeTable(baseId);

    must(await bob.db.from("tables").update({ deleted_at: new Date().toISOString() }).eq("id", tableId));

    // Still there, just no longer live. This is what makes the table recoverable
    // and what stops the cascade from taking fields, views and records with it.
    const { data } = await alice.db.from("tables").select("deleted_at").eq("id", tableId).single();
    expect(data!.deleted_at).not.toBeNull();
  });
});

// ─── Bases: the guard ───────────────────────────────────────────────────────

describe("base rename and delete", () => {
  it("a creator can rename a base", async () => {
    const { error } = await bob.db.from("bases").update({ name: "Renamed" }).eq("id", baseId);
    expect(error).toBeNull();

    const { data } = await alice.db.from("bases").select("name").eq("id", baseId).single();
    expect(data!.name).toBe("Renamed");
  });

  it("a CREATOR CANNOT delete a base — only an owner may", async () => {
    const { error } = await bob.db
      .from("bases")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", baseId);

    // 42501 from the trigger, not a silent no-op: he is allowed to UPDATE this row
    // (rename works, above), so RLS lets him through and the guard is what stops him.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");

    const { data } = await alice.db.from("bases").select("deleted_at").eq("id", baseId).single();
    expect(data!.deleted_at).toBeNull();
  });

  it("an OWNER can delete a base, softly", async () => {
    const { error } = await alice.db
      .from("bases")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", baseId);

    expect(error).toBeNull();

    const { data } = await alice.db.from("bases").select("deleted_at").eq("id", baseId).single();
    expect(data!.deleted_at).not.toBeNull();
  });

  it("a creator cannot restore one either — undeleting is the same authority", async () => {
    must(
      await alice.db.from("bases").update({ deleted_at: new Date().toISOString() }).eq("id", baseId)
    );

    const { error } = await bob.db.from("bases").update({ deleted_at: null }).eq("id", baseId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("the guard does not interfere with ordinary creator edits", async () => {
    // The trigger fires on every UPDATE. It must only care about deleted_at —
    // a guard that blocks renames would be worse than the hole it closes.
    const { error } = await bob.db
      .from("bases")
      .update({ name: "Fine", icon: "🐊", color: "#0f0" })
      .eq("id", baseId);

    expect(error).toBeNull();
  });
});
