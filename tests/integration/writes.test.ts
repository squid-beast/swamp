import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// The write path: concurrency, fractional ordering, and schema changes.
//
// These are the operations where "it worked when I tried it" and "it is correct"
// come apart. Two people editing at once, and two people dragging at once, are
// both fine 99 times out of 100 — which is exactly why the bug is so unpleasant.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let baseId: string;
let tableId: string;

beforeAll(async () => {
  alice = await createUser();

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Writes" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "T" }).select().single()
  ) as { id: string };
  tableId = table.id;

  must(
    await alice.db.from("fields").insert([
      { table_id: tableId, base_id: baseId, name: "A", key: "fld_a", type: "text", is_primary: true,  sort_order: 1 },
      { table_id: tableId, base_id: baseId, name: "B", key: "fld_b", type: "text", is_primary: false, sort_order: 2 },
    ])
  );
});

afterAll(async () => {
  await deleteUser(alice);
});

// ─── Concurrent cell edits ──────────────────────────────────────────────────

describe("swamp_patch_records", () => {
  it("merges INSIDE the update, so concurrent edits to different cells both survive", async () => {
    // THE bug this function exists to kill.
    //
    // The old code read the row, merged the new values into `data` in JavaScript,
    // and wrote the whole blob back. Two people editing DIFFERENT CELLS of the SAME
    // ROW would both read the old row, and the second write would clobber the first.
    // No error. No conflict. The edit simply vanished — after the person who made it
    // had already watched it appear in their grid.
    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_a: "1", fld_b: "1" } })
        .select()
        .single()
    ) as { id: string };

    // Two patches, fired together, touching different keys.
    await Promise.all([
      alice.db.rpc("swamp_patch_records", {
        p_table_id: tableId,
        p_patches: [{ id: record.id, values: { fld_a: "A wins" } }],
      }),
      alice.db.rpc("swamp_patch_records", {
        p_table_id: tableId,
        p_patches: [{ id: record.id, values: { fld_b: "B wins" } }],
      }),
    ]);

    const { data } = await alice.db.from("records").select("data").eq("id", record.id).single();
    const stored = data!.data as Record<string, unknown>;

    // BOTH survive. `data || patch` merges against whatever the row actually holds
    // at that moment, not against a stale copy some client read earlier.
    expect(stored.fld_a).toBe("A wins");
    expect(stored.fld_b).toBe("B wins");
  });

  it("leaves untouched keys alone", async () => {
    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_a: "keep", fld_b: "old" } })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db.rpc("swamp_patch_records", {
        p_table_id: tableId,
        p_patches: [{ id: record.id, values: { fld_b: "new" } }],
      })
    );

    const { data } = await alice.db.from("records").select("data").eq("id", record.id).single();
    expect(data!.data).toEqual({ fld_a: "keep", fld_b: "new" });
  });

  it("will not patch a record in a DIFFERENT table", async () => {
    const other = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Other" }).select().single()
    ) as { id: string };

    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_a: "safe" } })
        .select()
        .single()
    ) as { id: string };

    // Same record id, wrong table id. The function scopes by table_id, so this is a
    // no-op rather than a cross-table write.
    must(
      await alice.db.rpc("swamp_patch_records", {
        p_table_id: other.id,
        p_patches: [{ id: record.id, values: { fld_a: "hacked" } }],
      })
    );

    const { data } = await alice.db.from("records").select("data").eq("id", record.id).single();
    expect((data!.data as Record<string, unknown>).fld_a).toBe("safe");
  });
});

// ─── Fractional ordering ────────────────────────────────────────────────────

describe("swamp_move_record", () => {
  it("writes ONE row, not the whole table", async () => {
    // The entire reason sort_order is numeric and not int. With an int column,
    // inserting between 3 and 4 means shifting every row below — O(n) per drag, and
    // two people dragging at once collide.
    const rows = must(
      await alice.db
        .from("records")
        .insert([
          { table_id: tableId, base_id: baseId, sort_order: 100, data: { fld_a: "first" } },
          { table_id: tableId, base_id: baseId, sort_order: 200, data: { fld_a: "second" } },
          { table_id: tableId, base_id: baseId, sort_order: 300, data: { fld_a: "third" } },
        ])
        .select()
    ) as { id: string; sort_order: string; data: Record<string, string> }[];

    const third = rows.find((r) => r.data.fld_a === "third")!;
    const first = rows.find((r) => r.data.fld_a === "first")!;
    const second = rows.find((r) => r.data.fld_a === "second")!;

    // Move "third" between "first" and "second".
    const order = must(
      await alice.db.rpc("swamp_move_record", {
        p_table_id: tableId,
        p_record_id: third.id,
        p_before_id: first.id,
        p_after_id: second.id,
      })
    ) as unknown as number;

    expect(Number(order)).toBe(150); // the midpoint

    // The neighbours were NOT rewritten.
    const { data } = await alice.db
      .from("records")
      .select("id, sort_order")
      .in("id", [first.id, second.id]);

    const byId = new Map(data!.map((r) => [r.id, Number(r.sort_order)]));
    expect(byId.get(first.id)).toBe(100);
    expect(byId.get(second.id)).toBe(200);
  });

  it("moves to the top by halving, which never runs out of room", async () => {
    const rows = must(
      await alice.db
        .from("records")
        .insert([
          { table_id: tableId, base_id: baseId, sort_order: 1000, data: { fld_a: "top" } },
          { table_id: tableId, base_id: baseId, sort_order: 2000, data: { fld_a: "bottom" } },
        ])
        .select()
    ) as { id: string; data: Record<string, string> }[];

    const bottom = rows.find((r) => r.data.fld_a === "bottom")!;
    const top = rows.find((r) => r.data.fld_a === "top")!;

    const order = must(
      await alice.db.rpc("swamp_move_record", {
        p_table_id: tableId,
        p_record_id: bottom.id,
        p_before_id: null,
        p_after_id: top.id,
      })
    ) as unknown as number;

    // Halving, not subtracting. You can prepend to the top of a list forever.
    expect(Number(order)).toBe(500);
  });

  it("REBALANCES rather than colliding when precision runs out", async () => {
    // Rare, because numeric is arbitrary-precision. But "rare" is not "never", and
    // a silent collision means two rows with the same order and a list that
    // reshuffles itself on every read.
    const a = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, sort_order: 1, data: { fld_a: "x" } })
        .select()
        .single()
    ) as { id: string };
    const b = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, sort_order: 2, data: { fld_a: "y" } })
        .select()
        .single()
    ) as { id: string };
    const mover = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, sort_order: 9999, data: { fld_a: "z" } })
        .select()
        .single()
    ) as { id: string };

    // Bisect between a and b many times over. numeric holds up, but this at least
    // proves the path doesn't produce duplicates.
    for (let i = 0; i < 30; i++) {
      const res = await alice.db.rpc("swamp_move_record", {
        p_table_id: tableId,
        p_record_id: mover.id,
        p_before_id: a.id,
        p_after_id: b.id,
      });
      expect(res.error, `bisect ${i}`).toBeNull();
    }

    // Only the three records THIS test created. The table is shared across the
    // describe block, and sibling tests insert rows without an explicit sort_order —
    // which all default to 0, so a whole-table uniqueness check would fail on those
    // rather than on anything move did. Scope it to what we control.
    const { data } = await alice.db
      .from("records")
      .select("id, sort_order")
      .in("id", [a.id, b.id, mover.id]);

    // No two of them share an order after 30 bisections.
    const orders = data!.map((r) => String(r.sort_order));
    expect(new Set(orders).size).toBe(orders.length);
  });
});

// ─── The count must describe the rows ───────────────────────────────────────

describe("swamp_count_records honours search", () => {
  // swamp_count_records applied `filter` and never `search`, so the moment anyone
  // typed in the search box the grid showed the matching rows under a total counted
  // over the whole table — "3 rows" above a list of one.
  //
  // The assertion that matters is not "the count is 1". It is that the count AGREES
  // WITH THE ROWS: two functions, one definition of what search means. Asserting a
  // literal would pass just as happily if both drifted together.
  let tableId: string;

  beforeAll(async () => {
    const t = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Counted" }).select().single()
    ) as { id: string };
    tableId = t.id;

    must(
      await alice.db.from("fields").insert({
        table_id: tableId, base_id: baseId, name: "Name", key: "fld_name",
        type: "text", is_primary: true, sort_order: 1,
      }).select()
    );

    must(
      await alice.db.from("records").insert(
        ["alpha", "beta", "gamma"].map((n) => ({
          table_id: tableId, base_id: baseId, data: { fld_name: n },
        }))
      ).select()
    );
  });

  const rowsAndCount = async (spec: object) => {
    const [{ data: page }, { data: total }] = await Promise.all([
      alice.db.rpc("swamp_query_records", { p_table_id: tableId, p_spec: spec }),
      alice.db.rpc("swamp_count_records", { p_table_id: tableId, p_spec: spec }),
    ]);
    return {
      rows: ((page as { records: unknown[] }).records ?? []).length,
      count: Number(total),
    };
  };

  it("agrees with the rows when searching", async () => {
    const { rows, count } = await rowsAndCount({ search: "alpha" });
    expect(rows).toBe(1);
    expect(count).toBe(rows);
  });

  it("agrees when the search matches nothing", async () => {
    const { rows, count } = await rowsAndCount({ search: "nothing-matches-this" });
    expect(rows).toBe(0);
    expect(count).toBe(0);
  });

  it("agrees when search and filter combine", async () => {
    const { rows, count } = await rowsAndCount({
      search: "a",
      filter: { field: "fld_name", op: "neq", value: "gamma" },
    });
    expect(count).toBe(rows);
  });

  it("still counts everything with no search", async () => {
    const { rows, count } = await rowsAndCount({});
    expect(count).toBe(3);
    expect(count).toBe(rows);
  });
});
