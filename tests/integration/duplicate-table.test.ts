import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Duplicate a table — swamp_duplicate_table.
//
// The function is SECURITY INVOKER, so every read and write inside runs under the
// caller's RLS. That is the whole security story and it's what the last test pins:
// an editor can read the source but cannot create a table, so the copy fails at the
// first insert with 42501 rather than half-building a table nobody was allowed to
// make.
//
// The rest is fidelity: self-contained fields and their data come across with the
// SAME key (so the rows line up) and a fresh id, a default grid view is created so
// the copy opens, and the computed/relational fields are deliberately left behind.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser; // owner
let bob: TestUser; // granted a role on alice's base
let baseId: string;

async function makeBase(name = "Base") {
  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db.from("bases").insert({ workspace_id: workspaceId, name }).select().single()
  ) as { id: string };
  return base.id;
}

/** A table with two data fields, a computed field, a default view and two rows. */
async function makeTable(baseId: string, name = "Leads") {
  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name }).select().single()
  ) as { id: string };

  must(
    await alice.db.from("fields").insert([
      {
        table_id: table.id,
        base_id: baseId,
        name: "Name",
        key: "name",
        type: "text",
        options: {},
        is_primary: true,
        sort_order: 1,
      },
      {
        table_id: table.id,
        base_id: baseId,
        name: "Stage",
        key: "stage",
        type: "singleSelect",
        options: { options: [{ value: "New", color: "amber" }] },
        is_primary: false,
        sort_order: 2,
      },
      {
        // A formula field has no value in record.data and references other fields —
        // it must NOT be copied.
        table_id: table.id,
        base_id: baseId,
        name: "Upper",
        key: "upper",
        type: "formula",
        options: {},
        is_primary: false,
        sort_order: 3,
      },
    ])
  );

  must(
    await alice.db.from("views").insert({
      table_id: table.id,
      base_id: baseId,
      type: "grid",
      name: "Grid",
      is_default: true,
    })
  );

  must(
    await alice.db.from("records").insert([
      { table_id: table.id, base_id: baseId, data: { name: "Ada", stage: "New" }, sort_order: 1 },
      { table_id: table.id, base_id: baseId, data: { name: "Grace", stage: "New" }, sort_order: 2 },
    ])
  );

  return table.id;
}

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

beforeEach(async () => {
  baseId = await makeBase();
  must(
    await alice.db.from("base_members").insert({ base_id: baseId, user_id: bob.id, role: "creator" })
  );
});

describe("swamp_duplicate_table", () => {
  it("copies the schema, the rows, and a fresh default view", async () => {
    const src = await makeTable(baseId);

    const { data: newId, error } = await alice.db.rpc("swamp_duplicate_table", {
      p_table_id: src,
      p_with_records: true,
    });
    expect(error).toBeNull();
    expect(newId).toBeTruthy();

    // The table itself, renamed.
    const { data: table } = await alice.db
      .from("tables")
      .select("name")
      .eq("id", newId)
      .single();
    expect(table!.name).toBe("Leads copy");

    // Self-contained fields only — the formula is gone, and the copies keep their
    // keys but are brand-new rows.
    const { data: fields } = await alice.db
      .from("fields")
      .select("key, type, is_primary")
      .eq("table_id", newId)
      .is("deleted_at", null)
      .order("sort_order");
    expect(fields!.map((f) => f.key)).toEqual(["name", "stage"]);
    expect(fields!.some((f) => f.type === "formula")).toBe(false);
    expect(fields!.filter((f) => f.is_primary)).toHaveLength(1);

    // A default grid view so the copy opens.
    const { data: views } = await alice.db
      .from("views")
      .select("type, is_default")
      .eq("table_id", newId)
      .is("deleted_at", null);
    expect(views).toHaveLength(1);
    expect(views![0]).toMatchObject({ type: "grid", is_default: true });

    // The rows, data intact.
    const { data: records } = await alice.db
      .from("records")
      .select("data")
      .eq("table_id", newId)
      .is("deleted_at", null)
      .order("sort_order");
    expect(records).toHaveLength(2);
    expect(records!.map((r) => (r.data as { name: string }).name)).toEqual(["Ada", "Grace"]);
  });

  it("copies the schema but no rows when asked", async () => {
    const src = await makeTable(baseId);

    const { data: newId } = await alice.db.rpc("swamp_duplicate_table", {
      p_table_id: src,
      p_with_records: false,
    });

    const { count } = await alice.db
      .from("records")
      .select("*", { count: "exact", head: true })
      .eq("table_id", newId);
    expect(count).toBe(0);

    const { count: fieldCount } = await alice.db
      .from("fields")
      .select("*", { count: "exact", head: true })
      .eq("table_id", newId)
      .is("deleted_at", null);
    expect(fieldCount).toBe(2);
  });

  it("an editor cannot duplicate — creating a table is creator work", async () => {
    const src = await makeTable(baseId);
    must(
      await alice.db
        .from("base_members")
        .update({ role: "editor" })
        .eq("base_id", baseId)
        .eq("user_id", bob.id)
    );

    // Bob can read the source, so he gets past the initial select and is stopped by
    // the creator-gated insert — 42501, not a silent no-op.
    const { error } = await bob.db.rpc("swamp_duplicate_table", {
      p_table_id: src,
      p_with_records: true,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });
});
