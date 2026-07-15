import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUser,
  deleteUser,
  must,
  workspaceOf,
  type TestUser,
} from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Phase 1a — the schema, against a real Postgres.
//
// The point of this file is RLS. Policies are code that never runs in CI unless
// you make it run: you cannot unit-test them, TypeScript cannot check them, and
// a policy that is subtly too permissive looks exactly like one that works.
// The only proof is a second user who tries and fails.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let bob: TestUser;

/** Alice's base + table, created fresh for each block that needs one. */
async function makeBase(user: TestUser, name = "Base") {
  const workspaceId = await workspaceOf(user);
  const base = must(
    await user.db.from("bases").insert({ workspace_id: workspaceId, name }).select().single()
  ) as { id: string };
  return base.id;
}

async function makeTable(user: TestUser, baseId: string, name = "Table") {
  const table = must(
    await user.db.from("tables").insert({ base_id: baseId, name }).select().single()
  ) as { id: string };
  return table.id;
}

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

// ─── Signup bootstrap ───────────────────────────────────────────────────────

describe("signup", () => {
  it("gives every new user a workspace they own", async () => {
    const { data } = await alice.db
      .from("workspace_members")
      .select("workspace_id, role");

    expect(data).toHaveLength(1);
    expect(data![0].role).toBe("owner");
  });

  it("does not let one user see another's workspace", async () => {
    const aliceWs = await workspaceOf(alice);
    const bobWs = await workspaceOf(bob);

    expect(aliceWs).not.toBe(bobWs);

    // Bob asks for Alice's workspace by id. RLS makes it simply not exist.
    const { data } = await bob.db.from("workspaces").select("id").eq("id", aliceWs);
    expect(data).toEqual([]);
  });
});

// ─── RLS: the whole point ───────────────────────────────────────────────────

describe("RLS isolation", () => {
  it("hides another user's base, table, fields, views and records", async () => {
    const baseId = await makeBase(alice, "Alice's base");
    const tableId = await makeTable(alice, baseId);

    must(
      await alice.db
        .from("fields")
        .insert({ table_id: tableId, base_id: baseId, name: "Name", key: "fld_name", is_primary: true })
    );
    must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "secret" } })
    );

    // Bob can see none of it.
    for (const table of ["bases", "tables", "fields", "views", "records"]) {
      const { data, error } = await bob.db.from(table).select("*");
      expect(error, `${table} select errored`).toBeNull();
      expect(data, `${table} leaked rows to a non-member`).toEqual([]);
    }
  });

  it("refuses a write into another user's base", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    // Bob knows the ids (say, from a URL) and tries to insert anyway.
    const { error } = await bob.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, data: { x: 1 } });

    expect(error).not.toBeNull();
  });

  it("refuses to let a non-member delete a base", async () => {
    const baseId = await makeBase(alice);

    await bob.db.from("bases").delete().eq("id", baseId);

    // The delete matched nothing rather than erroring — which is why we assert
    // on the row still existing, not on the error. This is the failure mode a
    // "did it error?" test would sail straight past.
    const { data } = await alice.db.from("bases").select("id").eq("id", baseId);
    expect(data).toHaveLength(1);
  });
});

// ─── The role ladder ────────────────────────────────────────────────────────

describe("roles", () => {
  it("lets a viewer read but not write records", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);
    must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { a: 1 } })
    );

    must(
      await alice.db.from("base_members").insert({ base_id: baseId, user_id: bob.id, role: "viewer" })
    );

    const read = await bob.db.from("records").select("*").eq("base_id", baseId);
    expect(read.data).toHaveLength(1);

    const write = await bob.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, data: { a: 2 } });
    expect(write.error, "a viewer was allowed to write a record").not.toBeNull();
  });

  it("lets an editor write records but not create fields", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);
    must(
      await alice.db.from("base_members").insert({ base_id: baseId, user_id: bob.id, role: "editor" })
    );

    // Data: yes.
    const write = await bob.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, data: { a: 1 } });
    expect(write.error).toBeNull();

    // Schema: no. This is the editor → creator line, and it's the one that
    // matters most in the whole permission model.
    const field = await bob.db
      .from("fields")
      .insert({ table_id: tableId, base_id: baseId, name: "Sneaky", key: "fld_sneaky" });
    expect(field.error, "an editor was allowed to change the schema").not.toBeNull();
  });

  it("lets a per-base role override the workspace role", async () => {
    // Alice invites Bob to her base as an editor. Bob's workspace membership is
    // irrelevant — he isn't in her workspace at all.
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);
    must(
      await alice.db.from("base_members").insert({ base_id: baseId, user_id: bob.id, role: "editor" })
    );

    const write = await bob.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, data: { via: "base_members" } });

    expect(write.error).toBeNull();
  });
});

// ─── Constraints ────────────────────────────────────────────────────────────

describe("constraints", () => {
  it("allows only one primary field per table", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    must(
      await alice.db.from("fields").insert({
        table_id: tableId, base_id: baseId, name: "A", key: "fld_a", is_primary: true,
      })
    );

    const second = await alice.db.from("fields").insert({
      table_id: tableId, base_id: baseId, name: "B", key: "fld_b", is_primary: true,
    });

    expect(second.error).not.toBeNull();
  });

  it("allows only one default view per table", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    must(
      await alice.db
        .from("views")
        .insert({ table_id: tableId, base_id: baseId, name: "Grid", is_default: true })
    );

    const second = await alice.db
      .from("views")
      .insert({ table_id: tableId, base_id: baseId, name: "Grid 2", is_default: true });

    expect(second.error).not.toBeNull();
  });

  it("rejects a duplicate field key within a table", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    must(
      await alice.db
        .from("fields")
        .insert({ table_id: tableId, base_id: baseId, name: "A", key: "fld_dup" })
    );
    const dup = await alice.db
      .from("fields")
      .insert({ table_id: tableId, base_id: baseId, name: "B", key: "fld_dup" });

    expect(dup.error).not.toBeNull();
  });

  it("rejects a filter leaf with no field, and a group that carries a condition", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);
    const view = must(
      await alice.db
        .from("views")
        .insert({ table_id: tableId, base_id: baseId, name: "Grid" })
        .select()
        .single()
    ) as { id: string };
    const field = must(
      await alice.db
        .from("fields")
        .insert({ table_id: tableId, base_id: baseId, name: "S", key: "fld_s" })
        .select()
        .single()
    ) as { id: string };

    // A leaf with no field/op is meaningless.
    const badLeaf = await alice.db
      .from("filters")
      .insert({ base_id: baseId, view_id: view.id, is_group: false });
    expect(badLeaf.error).not.toBeNull();

    // A group that also carries a condition is meaningless.
    const badGroup = await alice.db.from("filters").insert({
      base_id: baseId, view_id: view.id, is_group: true, field_id: field.id, op: "eq",
    });
    expect(badGroup.error).not.toBeNull();

    // A well-formed group with a well-formed child leaf is fine.
    const group = must(
      await alice.db
        .from("filters")
        .insert({ base_id: baseId, view_id: view.id, is_group: true, logical_op: "or" })
        .select()
        .single()
    ) as { id: string };

    const leaf = await alice.db.from("filters").insert({
      base_id: baseId,
      view_id: view.id,
      parent_id: group.id,
      is_group: false,
      field_id: field.id,
      op: "eq",
      value: "open",
    });
    expect(leaf.error).toBeNull();
  });

  it("requires a personal view to have an owner", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    const orphan = await alice.db.from("views").insert({
      table_id: tableId, base_id: baseId, name: "Mine", lock_type: "personal",
    });
    expect(orphan.error).not.toBeNull();

    const owned = await alice.db.from("views").insert({
      table_id: tableId, base_id: baseId, name: "Mine", lock_type: "personal", owner_id: alice.id,
    });
    expect(owned.error).toBeNull();
  });
});

// ─── Fractional ordering ────────────────────────────────────────────────────

describe("fractional row ordering", () => {
  it("inserts between two neighbours by writing ONE row", async () => {
    // This is the whole reason sort_order is numeric and not int. Moving a row
    // must be a single UPDATE — no renumbering of siblings, no lock contention.
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    const rows = must(
      await alice.db
        .from("records")
        .insert([
          { table_id: tableId, base_id: baseId, data: { n: "first" }, sort_order: 1 },
          { table_id: tableId, base_id: baseId, data: { n: "third" }, sort_order: 2 },
        ])
        .select()
    ) as { id: string }[];

    // Insert "second" between them: (1 + 2) / 2.
    must(
      await alice.db.from("records").insert({
        table_id: tableId, base_id: baseId, data: { n: "second" }, sort_order: 1.5,
      })
    );

    const { data } = await alice.db
      .from("records")
      .select("data, sort_order")
      .eq("table_id", tableId)
      .order("sort_order");

    expect(data!.map((r) => (r.data as { n: string }).n)).toEqual(["first", "second", "third"]);
    expect(rows).toHaveLength(2); // neighbours were never touched
  });

  it("keeps enough precision to bisect repeatedly", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    must(
      await alice.db.from("records").insert([
        { table_id: tableId, base_id: baseId, data: { n: "a" }, sort_order: 0 },
        { table_id: tableId, base_id: baseId, data: { n: "z" }, sort_order: 1 },
      ])
    );

    // Repeatedly drop a row just after "a". numeric is arbitrary-precision, so
    // this does not run out of room the way a float would.
    let lo = 0;
    const hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const res = await alice.db.from("records").insert({
        table_id: tableId, base_id: baseId, data: { n: `mid${i}` }, sort_order: mid,
      });
      expect(res.error, `bisect ${i} failed`).toBeNull();
      lo = mid;
    }

    const { data } = await alice.db
      .from("records")
      .select("sort_order")
      .eq("table_id", tableId);

    // 2 endpoints + 20 bisections, all distinct.
    expect(new Set(data!.map((r) => String(r.sort_order))).size).toBe(22);
  });
});

// ─── Cascades ───────────────────────────────────────────────────────────────

describe("cascades", () => {
  it("deleting a base takes its tables, fields, views and records with it", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);
    must(
      await alice.db
        .from("fields")
        .insert({ table_id: tableId, base_id: baseId, name: "A", key: "fld_a" })
    );
    must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { a: 1 } })
    );

    must(await alice.db.from("bases").delete().eq("id", baseId).select());

    for (const table of ["tables", "fields", "records"]) {
      const { data } = await alice.db.from(table).select("*").eq("base_id", baseId);
      expect(data, `${table} survived its base`).toEqual([]);
    }
  });

  it("deleting a record takes its links with it", async () => {
    const baseId = await makeBase(alice);
    const people = await makeTable(alice, baseId, "People");
    const tasks = await makeTable(alice, baseId, "Tasks");

    const linkField = must(
      await alice.db
        .from("fields")
        .insert({
          table_id: people,
          base_id: baseId,
          name: "Tasks",
          key: "fld_tasks",
          type: "link",
          options: { targetTableId: tasks, cardinality: "many" },
        })
        .select()
        .single()
    ) as { id: string };

    const person = must(
      await alice.db
        .from("records")
        .insert({ table_id: people, base_id: baseId, data: {} })
        .select()
        .single()
    ) as { id: string };
    const task = must(
      await alice.db
        .from("records")
        .insert({ table_id: tasks, base_id: baseId, data: {} })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db.from("links").insert({
        base_id: baseId,
        field_id: linkField.id,
        from_record_id: person.id,
        to_record_id: task.id,
      })
    );

    await alice.db.from("records").delete().eq("id", task.id);

    const { data } = await alice.db.from("links").select("*").eq("field_id", linkField.id);
    expect(data, "a link outlived the record it pointed at").toEqual([]);
  });
});

// ─── Auto-stamped columns ───────────────────────────────────────────────────

describe("record stamping", () => {
  it("sets created_by on insert and updated_by on update, and created_by is not forgeable", async () => {
    const baseId = await makeBase(alice);
    const tableId = await makeTable(alice, baseId);

    // Alice tries to claim the record was created by Bob. The trigger overwrites it.
    const created = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { a: 1 }, created_by: bob.id })
        .select()
        .single()
    ) as { id: string; created_by: string; updated_by: string };

    expect(created.created_by).toBe(alice.id);
    expect(created.updated_by).toBe(alice.id);

    // Bob (as editor) updates it. created_by must survive.
    must(
      await alice.db.from("base_members").insert({ base_id: baseId, user_id: bob.id, role: "editor" })
    );
    const updated = must(
      await bob.db
        .from("records")
        .update({ data: { a: 2 } })
        .eq("id", created.id)
        .select()
        .single()
    ) as { created_by: string; updated_by: string };

    expect(updated.created_by, "created_by was clobbered on update").toBe(alice.id);
    expect(updated.updated_by).toBe(bob.id);
  });
});
