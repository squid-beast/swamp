import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Column-footer summaries — swamp_aggregate, against a real Postgres.
//
// The footer must describe the SAME set the grid shows: a sum computed over the
// loaded page is a lie the moment the table pages. So the aggregate runs in
// Postgres, through the identical filter/search predicate the rows are read with.
//
// Two things worth proving beyond "the sum is right":
//   • It honours filter AND search, so the footer tracks the visible set.
//   • The aggregation NAME is a whitelist that only SELECTS a fixed template — an
//     unknown name, or one invalid for the field's type, raises rather than being
//     interpolated into SQL. This is the mirror of aggregationsFor in TS.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let bob: TestUser;
let tableId: string;

type Spec = Record<string, unknown>;
type Aggs = Record<string, string>;

const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
};

const dueAcme = day(-2);
const dueDelta = day(2);

async function agg(spec: Spec, aggs: Aggs, db: SupabaseClient = alice.db, id = tableId) {
  const { data, error } = await db.rpc("swamp_aggregate", {
    p_table_id: id,
    p_spec: spec,
    p_aggs: aggs,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db.from("bases").insert({ workspace_id: workspaceId, name: "Agg" }).select().single()
  ) as { id: string };
  const table = must(
    await alice.db.from("tables").insert({ base_id: base.id, name: "Deals" }).select().single()
  ) as { id: string };
  tableId = table.id;

  const fields = must(
    await alice.db.from("fields").insert([
      { table_id: tableId, base_id: base.id, name: "Name",   key: "fld_name",   type: "text",     is_primary: true,  sort_order: 1 },
      { table_id: tableId, base_id: base.id, name: "Amount", key: "fld_amount", type: "currency", is_primary: false, sort_order: 2 },
      { table_id: tableId, base_id: base.id, name: "Due",    key: "fld_due",    type: "date",     is_primary: false, sort_order: 3 },
      { table_id: tableId, base_id: base.id, name: "Won",    key: "fld_won",    type: "boolean",  is_primary: false, sort_order: 4 },
    ]).select()
  ) as { id: string; key: string }[];

  const amountId = fields.find((f) => f.key === "fld_amount")!.id;

  // A computed column: Doubled = Amount * 2. It registers in the catalog AS a
  // formula, so only the COMMON summaries are legal for it (never sum) — the same
  // gate aggregationsFor applies in TS.
  must(
    await alice.db.from("fields").insert({
      table_id: tableId, base_id: base.id, name: "Doubled", key: "fld_doubled",
      type: "formula", is_primary: false, sort_order: 5,
      options: { ast: { t: "bin", op: "*", l: { t: "field", id: amountId }, r: { t: "num", v: 2 } } },
    })
  );

  must(
    await alice.db.from("records").insert([
      { table_id: tableId, base_id: base.id, sort_order: 1, data: { fld_name: "Acme",  fld_amount: "10", fld_due: dueAcme,  fld_won: "true"  } },
      { table_id: tableId, base_id: base.id, sort_order: 2, data: { fld_name: "Acorn", fld_amount: "20", fld_due: day(-1),  fld_won: "false" } },
      { table_id: tableId, base_id: base.id, sort_order: 3, data: { fld_name: "Beta",  fld_amount: "30", fld_due: day(0),   fld_won: "true"  } },
      { table_id: tableId, base_id: base.id, sort_order: 4, data: { fld_name: "Ceres", fld_amount: "40", fld_due: day(1),   fld_won: "true"  } },
      { table_id: tableId, base_id: base.id, sort_order: 5, data: { fld_name: "Delta", fld_amount: "50", fld_due: dueDelta, fld_won: "false" } },
    ])
  );
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

// ─── Numeric summaries ───────────────────────────────────────────────────────

describe("numeric summaries", () => {
  it("computes sum / avg / min / max / median correctly over the whole table", async () => {
    const values = await agg({}, {
      fld_amount: "sum",
    });
    expect(Number(values.fld_amount)).toBe(150);

    expect(Number((await agg({}, { fld_amount: "avg" })).fld_amount)).toBe(30);
    expect(Number((await agg({}, { fld_amount: "min" })).fld_amount)).toBe(10);
    expect(Number((await agg({}, { fld_amount: "max" })).fld_amount)).toBe(50);
    expect(Number((await agg({}, { fld_amount: "median" })).fld_amount)).toBe(30);
  });

  it("returns a value per requested field in one call", async () => {
    const values = await agg({}, { fld_amount: "sum", fld_name: "count" });
    expect(Number(values.fld_amount)).toBe(150);
    expect(Number(values.fld_name)).toBe(5);
  });
});

// ─── Filter- and search-aware ────────────────────────────────────────────────

describe("summaries track the visible set", () => {
  it("changes with a filter — the footer describes only the filtered rows", async () => {
    const values = await agg(
      { filter: { field: "fld_amount", op: "gt", value: 25 } },
      { fld_amount: "sum", fld_name: "count" }
    );
    // Beta + Ceres + Delta = 30 + 40 + 50
    expect(Number(values.fld_amount)).toBe(120);
    expect(Number(values.fld_name)).toBe(3);
  });

  it("changes with a search — same predicate the grid reads with", async () => {
    const values = await agg(
      { search: "ac" },
      { fld_amount: "sum", fld_name: "count" }
    );
    // "Acme" (10) + "Acorn" (20)
    expect(Number(values.fld_amount)).toBe(30);
    expect(Number(values.fld_name)).toBe(2);
  });
});

// ─── Date summaries ──────────────────────────────────────────────────────────

describe("date summaries", () => {
  it("finds the earliest and latest date", async () => {
    const values = await agg({}, { fld_due: "earliest" });
    expect(new Date(values.fld_due as string).getTime()).toBe(new Date(dueAcme).getTime());

    const latest = await agg({}, { fld_due: "latest" });
    expect(new Date(latest.fld_due as string).getTime()).toBe(new Date(dueDelta).getTime());
  });
});

// ─── Boolean summaries ───────────────────────────────────────────────────────

describe("boolean summaries", () => {
  it("counts checked and unchecked", async () => {
    const values = await agg({}, { fld_won: "checked", fld_name: "count" });
    expect(Number(values.fld_won)).toBe(3);
    expect(Number(values.fld_name)).toBe(5);
  });
});

// ─── Computed (formula) column ───────────────────────────────────────────────

describe("aggregating a computed column", () => {
  it("allows a COMMON summary over a formula column", async () => {
    // Doubled has a value on every row, so count_filled is all 5. A formula
    // registers in the catalog as its own type, so only the common set is legal.
    const values = await agg({}, { fld_doubled: "count_filled" });
    expect(Number(values.fld_doubled)).toBe(5);
  });

  it("refuses a numeric summary on a formula column — it isn't numeric-typed", async () => {
    await expect(agg({}, { fld_doubled: "sum" })).rejects.toThrow(/not valid for field/i);
  });
});

// ─── The whitelist boundary ──────────────────────────────────────────────────

describe("the aggregation name is a whitelist, not interpolated SQL", () => {
  it("rejects an unknown aggregation name rather than interpolating it", async () => {
    await expect(agg({}, { fld_amount: "sum); drop table public.records; --" }))
      .rejects.toThrow(/not valid for field/i);
    // And the table is intact.
    expect(Number((await agg({}, { fld_name: "count" })).fld_name)).toBe(5);
  });

  it("rejects a numeric name on a text field — a text column offers only the common set", async () => {
    await expect(agg({}, { fld_name: "sum" })).rejects.toThrow(/not valid for field/i);
    await expect(agg({}, { fld_name: "avg" })).rejects.toThrow(/not valid for field/i);
    // But the common summaries are fine on text.
    expect(Number((await agg({}, { fld_name: "count_unique" })).fld_name)).toBe(5);
  });

  it("rejects an unknown field instead of guessing", async () => {
    await expect(agg({}, { fld_nope: "count" })).rejects.toThrow(/unknown field/i);
  });
});

// ─── Security ────────────────────────────────────────────────────────────────

describe("security", () => {
  it("refuses to aggregate a table the caller cannot read", async () => {
    // SECURITY INVOKER: RLS applies. Bob knows the id and asks anyway.
    await expect(agg({}, { fld_amount: "sum" }, bob.db)).rejects.toThrow();
  });
});
