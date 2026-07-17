import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anon, createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// View config: filters, sorts, per-view field visibility.
//
// This is the thing the old model didn't have. `ViewConfig.filters` and `.sort`
// were declared in the types and READ BY NOTHING — filters lived in a component's
// useState, evaporated on navigation, and were never shared with anyone.
//
// The tests that matter here are about ROUND-TRIPPING: a filter tree written to
// the database and read back must be the same tree, and it must still be the same
// tree after the field it references is renamed.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let baseId: string;
let tableId: string;
let viewId: string;
let statusFieldId: string;
let amountFieldId: string;

/** Insert a filter tree the way the app does: one row per node, parent_id linking. */
async function writeFilters(
  db: SupabaseClient,
  rows: Record<string, unknown>[]
): Promise<void> {
  await db.from("filters").delete().eq("view_id", viewId);
  if (!rows.length) return;

  // PostgREST bulk insert takes the UNION of keys across the array and sends NULL
  // for any row that omits one — it does NOT fall back to the column default. A
  // leaf node here omits `logical_op`, so without this it arrives as NULL and trips
  // the NOT NULL constraint. The app's saveFilterTree sets logical_op on every row
  // (leaves get 'and'); mirror that so the test inserts data the app could produce.
  const normalized = rows.map((r) => ({ logical_op: "and", ...r }));
  must(await db.from("filters").insert(normalized));
}

beforeAll(async () => {
  alice = await createUser();

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Cfg" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "T" }).select().single()
  ) as { id: string };
  tableId = table.id;

  const fields = must(
    await alice.db
      .from("fields")
      .insert([
        { table_id: tableId, base_id: baseId, name: "Status", key: "fld_status", type: "status", is_primary: true, sort_order: 1 },
        { table_id: tableId, base_id: baseId, name: "Amount", key: "fld_amount", type: "currency", is_primary: false, sort_order: 2 },
      ])
      .select()
  ) as { id: string; key: string }[];

  statusFieldId = fields.find((f) => f.key === "fld_status")!.id;
  amountFieldId = fields.find((f) => f.key === "fld_amount")!.id;

  const view = must(
    await alice.db
      .from("views")
      .insert({ table_id: tableId, base_id: baseId, name: "Grid", is_default: true })
      .select()
      .single()
  ) as { id: string };
  viewId = view.id;
});

afterAll(async () => {
  await deleteUser(alice);
});

describe("filter tree persistence", () => {
  it("stores a nested tree and links children to their parent", async () => {
    const groupId = crypto.randomUUID();

    await writeFilters(alice.db, [
      {
        id: groupId,
        base_id: baseId,
        view_id: viewId,
        is_group: true,
        logical_op: "or",
        sort_order: 0,
      },
      {
        id: crypto.randomUUID(),
        base_id: baseId,
        view_id: viewId,
        parent_id: groupId,
        is_group: false,
        field_id: statusFieldId,
        op: "eq",
        value: "open",
        sort_order: 0,
      },
      {
        id: crypto.randomUUID(),
        base_id: baseId,
        view_id: viewId,
        parent_id: groupId,
        is_group: false,
        field_id: amountFieldId,
        op: "gt",
        value: 900,
        sort_order: 1,
      },
    ]);

    const { data } = await alice.db
      .from("filters")
      .select("id, parent_id, is_group, op")
      .eq("view_id", viewId);

    expect(data).toHaveLength(3);
    expect(data!.filter((r) => r.parent_id === groupId)).toHaveLength(2);
  });

  it("survives a field RENAME — the filter references the id, not the name", async () => {
    // This is the whole reason fields have both a `name` and a `key`, and why the
    // filter table stores field_id. Rename a column and every filter, sort and
    // formula that touches it must keep working. If filters stored the display
    // name, this would silently break every view in the base.
    must(
      await alice.db
        .from("fields")
        .update({ name: "Deal Stage" })
        .eq("id", statusFieldId)
    );

    const { data } = await alice.db
      .from("filters")
      .select("field_id, op, value")
      .eq("view_id", viewId)
      .eq("field_id", statusFieldId)
      .maybeSingle();

    expect(data).not.toBeNull();
    expect(data!.op).toBe("eq");

    // And the key — the thing that actually addresses the data — is untouched.
    const { data: field } = await alice.db
      .from("fields")
      .select("key, name")
      .eq("id", statusFieldId)
      .single();

    expect(field!.name).toBe("Deal Stage");
    expect(field!.key).toBe("fld_status");
  });

  it("cascades filters away when the view is deleted", async () => {
    const tmp = must(
      await alice.db
        .from("views")
        .insert({ table_id: tableId, base_id: baseId, name: "Temp" })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db.from("filters").insert({
        base_id: baseId,
        view_id: tmp.id,
        is_group: false,
        field_id: statusFieldId,
        op: "eq",
        value: "x",
      })
    );

    await alice.db.from("views").delete().eq("id", tmp.id);

    const { data } = await alice.db.from("filters").select("id").eq("view_id", tmp.id);
    expect(data).toEqual([]);
  });

  it("cascades a filter away when its FIELD is hard-deleted", async () => {
    const tmpField = must(
      await alice.db
        .from("fields")
        .insert({
          table_id: tableId, base_id: baseId, name: "Temp",
          key: "fld_temp", type: "text", is_primary: false, sort_order: 9,
        })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db.from("filters").insert({
        base_id: baseId, view_id: viewId, is_group: false,
        field_id: tmpField.id, op: "eq", value: "x", sort_order: 5,
      })
    );

    await alice.db.from("fields").delete().eq("id", tmpField.id);

    const { data } = await alice.db
      .from("filters")
      .select("id")
      .eq("field_id", tmpField.id);
    expect(data).toEqual([]);
  });
});

describe("sorts", () => {
  it("stores precedence as sort_order", async () => {
    must(
      await alice.db.from("sorts").insert([
        { view_id: viewId, base_id: baseId, field_id: statusFieldId, direction: "asc", sort_order: 0 },
        { view_id: viewId, base_id: baseId, field_id: amountFieldId, direction: "desc", sort_order: 1 },
      ])
    );

    const { data } = await alice.db
      .from("sorts")
      .select("field_id, direction, sort_order")
      .eq("view_id", viewId)
      .order("sort_order");

    // "Sort by status, then by amount desc" is a different result from the
    // reverse. The order of this list IS the precedence.
    expect(data!.map((s) => s.direction)).toEqual(["asc", "desc"]);
    expect(data![0].field_id).toBe(statusFieldId);
  });

  it("refuses two sorts on the same field", async () => {
    const dup = await alice.db.from("sorts").insert({
      view_id: viewId, base_id: baseId, field_id: statusFieldId,
      direction: "desc", sort_order: 2,
    });
    expect(dup.error).not.toBeNull();
  });
});

describe("view fields", () => {
  it("is per-view — two views of one table can show different columns", async () => {
    const other = must(
      await alice.db
        .from("views")
        .insert({ table_id: tableId, base_id: baseId, name: "Second" })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db.from("view_fields").insert([
        { view_id: viewId, field_id: amountFieldId, base_id: baseId, show: true, sort_order: 1 },
        { view_id: other.id, field_id: amountFieldId, base_id: baseId, show: false, sort_order: 1 },
      ])
    );

    const { data } = await alice.db
      .from("view_fields")
      .select("view_id, show")
      .eq("field_id", amountFieldId);

    const byView = new Map(data!.map((r) => [r.view_id, r.show]));
    expect(byView.get(viewId)).toBe(true);
    expect(byView.get(other.id)).toBe(false);
  });
});

// ─── Group-by: the group list ───────────────────────────────────────────────

describe("swamp_group_counts", () => {
  // The engine half of group-by. It answers only "what are the distinct values of
  // this field, under this filter and search, and how many records has each" — the
  // group HEADERS. Rows for an expanded group are the existing query with an
  // ordinary `eq` filter on the group value, which is why the keyset cursor needs
  // no changes and a COLLAPSED group can cost nothing.
  let tableId: string;

  beforeAll(async () => {
    const t = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Grouped" }).select().single()
    ) as { id: string };
    tableId = t.id;

    must(
      await alice.db.from("fields").insert([
        { table_id: tableId, base_id: baseId, name: "Name", key: "fld_name", type: "text", is_primary: true, sort_order: 1 },
        { table_id: tableId, base_id: baseId, name: "Status", key: "fld_status", type: "singleSelect", is_primary: false, sort_order: 2 },
        { table_id: tableId, base_id: baseId, name: "Tags", key: "fld_tags", type: "multiSelect", is_primary: false, sort_order: 3 },
      ]).select()
    );

    must(
      await alice.db.from("records").insert([
        { table_id: tableId, base_id: baseId, data: { fld_name: "alpha", fld_status: "open" } },
        { table_id: tableId, base_id: baseId, data: { fld_name: "beta", fld_status: "open" } },
        { table_id: tableId, base_id: baseId, data: { fld_name: "gamma", fld_status: "closed" } },
        { table_id: tableId, base_id: baseId, data: { fld_name: "delta" } },
      ]).select()
    );
  });

  const groups = async (spec: object = {}, field = "fld_status", dir = "asc") => {
    const { data, error } = await alice.db.rpc("swamp_group_counts", {
      p_table_id: tableId, p_spec: spec, p_field: field, p_dir: dir,
    });
    if (error) throw new Error(error.message);
    return data as { value: unknown; count: number }[];
  };

  it("counts each distinct value, with the empty group last", async () => {
    // Nulls last, not first: a record with no status is the least interesting
    // bucket and belongs at the bottom, the same place a null sorts in the grid.
    expect(await groups()).toEqual([
      { value: "closed", count: 1 },
      { value: "open", count: 2 },
      { value: null, count: 1 },
    ]);
  });

  it("descends when asked", async () => {
    const g = await groups({}, "fld_status", "desc");
    expect(g.map((x) => x.value)).toEqual(["open", "closed", null]);
  });

  it("counts the FILTERED set, not the table", async () => {
    // A group list that ignored the view's filter would sum to more than the total
    // and read as a bug.
    const g = await groups({ filter: { field: "fld_name", op: "neq", value: "beta" } });
    expect(g).toEqual([
      { value: "closed", count: 1 },
      { value: "open", count: 1 },
      { value: null, count: 1 },
    ]);
  });

  it("counts the SEARCHED set", async () => {
    expect(await groups({ search: "alpha" })).toEqual([{ value: "open", count: 1 }]);
  });

  it("sums to the same total the grid shows", async () => {
    // The property that matters: headers and total come from different functions
    // and must agree. They only do because both honour filter AND search.
    const spec = { search: "a" };
    const g = await groups(spec);
    const { data: total } = await alice.db.rpc("swamp_count_records", {
      p_table_id: tableId, p_spec: spec,
    });
    expect(g.reduce((n, x) => n + Number(x.count), 0)).toBe(Number(total));
  });

  it("refuses a field that isn't in the catalog", async () => {
    // The injection boundary. A field name the client invents never reaches the SQL
    // — only the catalog's own expression does.
    await expect(groups({}, "fld_nope; drop table records;--")).rejects.toThrow(/unknown field/);
  });

  it("refuses to group by a multiSelect", async () => {
    // A group is only useful if you can ask for its rows, and that ask is an `eq`
    // filter. multiSelect holds a jsonb array — `eq` on it is not a membership
    // test, and its expr coalesces to '[]' rather than NULL, so "no tags" would
    // bucket under the string "[]" instead of the empty group. Two meanings of
    // "in that group" is one too many.
    await expect(groups({}, "fld_tags")).rejects.toThrow(/cannot group by/);
  });

  it("is not reachable by anon", async () => {
    const { error } = await anon().rpc("swamp_group_counts", {
      p_table_id: tableId, p_spec: {}, p_field: "fld_status",
    });
    expect(error).not.toBeNull();
  });
});
