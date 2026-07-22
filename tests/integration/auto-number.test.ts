import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// autoNumber — a durable, gap-free, un-forgeable sequence.
//
// The property that makes it worth a trigger rather than a column DEFAULT is that
// it behaves like created_by: the SERVER decides the number, once, and no client
// on any path can set it or change it afterwards. These tests are written to try.
//
// See supabase/migrations/20260718000000_auto_number.sql.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let baseId: string;

beforeAll(async () => {
  alice = await createUser();

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "AutoNumber" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;
});

afterAll(async () => {
  await deleteUser(alice);
});

/** A fresh table with a primary text field and an autoNumber field. */
async function tableWithAutoNumber(name: string, key = "fld_seq") {
  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name }).select().single()
  ) as { id: string };

  must(
    await alice.db.from("fields").insert([
      { table_id: table.id, base_id: baseId, name: "Name", key: "fld_name", type: "text", is_primary: true, sort_order: 1 },
      { table_id: table.id, base_id: baseId, name: "Seq", key, type: "autoNumber", is_primary: false, sort_order: 2 },
    ])
  );

  return table.id;
}

async function seqOf(tableId: string, id: string, key = "fld_seq") {
  const { data } = await alice.db.from("records").select("data").eq("id", id).single();
  return (data!.data as Record<string, unknown>)[key];
}

describe("autoNumber assignment", () => {
  it("numbers records 1, 2, 3… in creation order", async () => {
    const tableId = await tableWithAutoNumber("Counting");

    const a = must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, sort_order: 1, data: { fld_name: "a" } }).select().single()) as { id: string };
    const b = must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, sort_order: 2, data: { fld_name: "b" } }).select().single()) as { id: string };
    const c = must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, sort_order: 3, data: { fld_name: "c" } }).select().single()) as { id: string };

    expect(await seqOf(tableId, a.id)).toBe(1);
    expect(await seqOf(tableId, b.id)).toBe(2);
    expect(await seqOf(tableId, c.id)).toBe(3);
  });

  it("is un-forgeable: a value sent by the client is ignored", async () => {
    const tableId = await tableWithAutoNumber("Forge");

    // A client tries to claim #999. Same energy as a POST claiming created_by.
    const r = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "x", fld_seq: 999 } })
        .select()
        .single()
    ) as { id: string };

    expect(await seqOf(tableId, r.id)).toBe(1);
  });

  it("is immutable: a PATCH cannot renumber a record", async () => {
    const tableId = await tableWithAutoNumber("Freeze");

    const r = must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, data: { fld_name: "x" } }).select().single()) as { id: string };
    expect(await seqOf(tableId, r.id)).toBe(1);

    // Both the merge-path RPC and a raw column update must bounce off it.
    must(
      await alice.db.rpc("swamp_patch_records", {
        p_table_id: tableId,
        p_patches: [{ id: r.id, values: { fld_seq: 999, fld_name: "y" } }],
      })
    );

    expect(await seqOf(tableId, r.id)).toBe(1);
    // The writable sibling field DID change — proof the patch ran, and only the
    // autoNumber was frozen.
    const { data } = await alice.db.from("records").select("data").eq("id", r.id).single();
    expect((data!.data as Record<string, unknown>).fld_name).toBe("y");
  });

  it("is gap-free and never reuses a number after a delete", async () => {
    const tableId = await tableWithAutoNumber("Gaps");

    const a = must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, data: { fld_name: "a" } }).select().single()) as { id: string };
    const b = must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, data: { fld_name: "b" } }).select().single()) as { id: string };
    expect(await seqOf(tableId, a.id)).toBe(1);
    expect(await seqOf(tableId, b.id)).toBe(2);

    // Soft-delete #2. The counter does not rewind — #2 is spent forever.
    must(await alice.db.from("records").update({ deleted_at: new Date().toISOString() }).eq("id", b.id));

    const c = must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, data: { fld_name: "c" } }).select().single()) as { id: string };
    expect(await seqOf(tableId, c.id)).toBe(3);
  });

  it("counts each autoNumber field independently", async () => {
    // Two autoNumber fields on one table each keep their own counter.
    const table = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "TwoSeqs" }).select().single()
    ) as { id: string };

    must(
      await alice.db.from("fields").insert([
        { table_id: table.id, base_id: baseId, name: "Name", key: "fld_name", type: "text", is_primary: true, sort_order: 1 },
        { table_id: table.id, base_id: baseId, name: "One", key: "fld_one", type: "autoNumber", is_primary: false, sort_order: 2 },
        { table_id: table.id, base_id: baseId, name: "Two", key: "fld_two", type: "autoNumber", is_primary: false, sort_order: 3 },
      ])
    );

    const r = must(await alice.db.from("records").insert({ table_id: table.id, base_id: baseId, data: { fld_name: "x" } }).select().single()) as { id: string };
    const { data } = await alice.db.from("records").select("data").eq("id", r.id).single();
    const stored = data!.data as Record<string, unknown>;

    expect(stored.fld_one).toBe(1);
    expect(stored.fld_two).toBe(1);
  });
});

describe("autoNumber backfill", () => {
  it("numbers existing rows in order when the field is added, then continues", async () => {
    const table = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Backfill" }).select().single()
    ) as { id: string };

    must(
      await alice.db.from("fields").insert({
        table_id: table.id, base_id: baseId, name: "Name", key: "fld_name",
        type: "text", is_primary: true, sort_order: 1,
      })
    );

    // Three rows exist BEFORE the autoNumber field does.
    const rows = must(
      await alice.db.from("records").insert([
        { table_id: table.id, base_id: baseId, sort_order: 10, data: { fld_name: "first" } },
        { table_id: table.id, base_id: baseId, sort_order: 20, data: { fld_name: "second" } },
        { table_id: table.id, base_id: baseId, sort_order: 30, data: { fld_name: "third" } },
      ]).select()
    ) as { id: string; data: Record<string, string> }[];

    // Add it. The AFTER INSERT trigger on `fields` backfills existing rows.
    must(
      await alice.db.from("fields").insert({
        table_id: table.id, base_id: baseId, name: "Seq", key: "fld_seq",
        type: "autoNumber", is_primary: false, sort_order: 2,
      })
    );

    const byName = (n: string) => rows.find((r) => r.data.fld_name === n)!.id;
    expect(await seqOf(table.id, byName("first"))).toBe(1);
    expect(await seqOf(table.id, byName("second"))).toBe(2);
    expect(await seqOf(table.id, byName("third"))).toBe(3);

    // And the counter is seeded, so the next insert continues from 4 — no collision
    // with the backfilled values.
    const d = must(await alice.db.from("records").insert({ table_id: table.id, base_id: baseId, sort_order: 40, data: { fld_name: "fourth" } }).select().single()) as { id: string };
    expect(await seqOf(table.id, d.id)).toBe(4);
  });
});

describe("autoNumber in the query engine", () => {
  it("sorts and filters as a number, not as text", async () => {
    const tableId = await tableWithAutoNumber("Numeric", "fld_seq");

    // Insert enough that a text sort would disagree with a numeric one: as text,
    // "10" < "9"; as a number, 9 < 10.
    for (let i = 0; i < 11; i++) {
      must(await alice.db.from("records").insert({ table_id: tableId, base_id: baseId, sort_order: i, data: { fld_name: `r${i}` } }));
    }

    const desc = must(
      await alice.db.rpc("swamp_query_records", {
        p_table_id: tableId,
        p_spec: { sort: [{ field: "fld_seq", dir: "desc" }], limit: 3 },
      })
    ) as { records: { data: Record<string, unknown> }[] };

    // Highest first: 11, 10, 9 — a text sort would have put 9 at the top.
    expect(desc.records.map((r) => r.data.fld_seq)).toEqual([11, 10, 9]);

    const gt = must(
      await alice.db.rpc("swamp_count_records", {
        p_table_id: tableId,
        p_spec: { filter: { field: "fld_seq", op: "gt", value: 9 } },
      })
    ) as unknown as number;

    // Strictly greater than 9 → {10, 11} → two.
    expect(Number(gt)).toBe(2);
  });
});
