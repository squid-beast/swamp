import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anon, createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Phase 2 — the relational core, against real Postgres.
//
// The claim being tested is the one the whole design rests on: links, lookups,
// rollups and formulas compile into SQL EXPRESSIONS, which means they are
// filterable and sortable for free.
//
// "Show me Companies whose total deal value > 1000, sorted by it" is not a
// feature anyone wrote. If it works, the design is right. If it doesn't, we've
// built a slower version of resolving them in JavaScript.
//
// Scenario: Companies ←→ Deals.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let baseId: string;
let companies: string;
let deals: string;

let companyNameId: string;
let dealNameId: string;
let dealAmountId: string;
let dealsLinkId: string;

const acme: Record<string, string> = {};
const globex: Record<string, string> = {};

type Rec = { id: string; data: Record<string, unknown> };

async function query(db: SupabaseClient, tableId: string, spec: object = {}): Promise<Rec[]> {
  const { data, error } = await db.rpc("swamp_query_records", {
    p_table_id: tableId,
    p_spec: spec,
  });
  if (error) throw new Error(error.message);
  return (data as { records: Rec[] }).records;
}

async function makeField(
  tableId: string,
  name: string,
  key: string,
  type: string,
  options: object = {},
  isPrimary = false
): Promise<string> {
  const f = must(
    await alice.db
      .from("fields")
      .insert({
        table_id: tableId,
        base_id: baseId,
        name,
        key,
        type,
        options,
        is_primary: isPrimary,
        sort_order: 1,
      })
      .select()
      .single()
  ) as { id: string };
  return f.id;
}

beforeAll(async () => {
  alice = await createUser();

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "CRM" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const tables = must(
    await alice.db
      .from("tables")
      .insert([
        { base_id: baseId, name: "Companies" },
        { base_id: baseId, name: "Deals" },
      ])
      .select()
  ) as { id: string; name: string }[];

  companies = tables.find((t) => t.name === "Companies")!.id;
  deals = tables.find((t) => t.name === "Deals")!.id;

  companyNameId = await makeField(companies, "Name", "fld_name", "text", {}, true);
  dealNameId = await makeField(deals, "Deal", "fld_deal", "text", {}, true);
  dealAmountId = await makeField(deals, "Amount", "fld_amount", "currency");

  // The link, with its mirror — created together, referencing each other.
  const linkFields = must(
    await alice.db
      .from("fields")
      .insert([
        {
          table_id: companies,
          base_id: baseId,
          name: "Deals",
          key: "fld_deals",
          type: "link",
          options: { targetTableId: deals, cardinality: "many" },
          is_primary: false,
          sort_order: 2,
        },
        {
          table_id: deals,
          base_id: baseId,
          name: "Company",
          key: "fld_company",
          type: "link",
          options: { targetTableId: companies, cardinality: "one" },
          is_primary: false,
          sort_order: 3,
        },
      ])
      .select()
  ) as { id: string; table_id: string }[];

  dealsLinkId = linkFields.find((f) => f.table_id === companies)!.id;
  const companyLinkId = linkFields.find((f) => f.table_id === deals)!.id;

  await Promise.all([
    alice.db
      .from("fields")
      .update({
        options: { targetTableId: deals, cardinality: "many", symmetricFieldId: companyLinkId },
      })
      .eq("id", dealsLinkId),
    alice.db
      .from("fields")
      .update({
        options: { targetTableId: companies, cardinality: "one", symmetricFieldId: dealsLinkId },
      })
      .eq("id", companyLinkId),
  ]);

  // Records.
  const cos = must(
    await alice.db
      .from("records")
      .insert([
        { table_id: companies, base_id: baseId, sort_order: 1, data: { fld_name: "Acme" } },
        { table_id: companies, base_id: baseId, sort_order: 2, data: { fld_name: "Globex" } },
      ])
      .select()
  ) as { id: string; data: Record<string, string> }[];

  acme.id = cos.find((c) => c.data.fld_name === "Acme")!.id;
  globex.id = cos.find((c) => c.data.fld_name === "Globex")!.id;

  const ds = must(
    await alice.db
      .from("records")
      .insert([
        { table_id: deals, base_id: baseId, sort_order: 1, data: { fld_deal: "Acme A", fld_amount: "1000" } },
        { table_id: deals, base_id: baseId, sort_order: 2, data: { fld_deal: "Acme B", fld_amount: "500" } },
        { table_id: deals, base_id: baseId, sort_order: 3, data: { fld_deal: "Globex A", fld_amount: "300" } },
        // A deal with garbage in its amount. A naive ::numeric cast in the rollup
        // would throw and take the whole query down.
        { table_id: deals, base_id: baseId, sort_order: 4, data: { fld_deal: "Acme C", fld_amount: "N/A" } },
      ])
      .select()
  ) as { id: string; data: Record<string, string> }[];

  const byName = new Map(ds.map((d) => [d.data.fld_deal, d.id]));

  must(
    await alice.db.from("links").insert([
      { base_id: baseId, field_id: dealsLinkId, from_record_id: acme.id, to_record_id: byName.get("Acme A")!, sort_order: 1 },
      { base_id: baseId, field_id: dealsLinkId, from_record_id: acme.id, to_record_id: byName.get("Acme B")!, sort_order: 2 },
      { base_id: baseId, field_id: dealsLinkId, from_record_id: acme.id, to_record_id: byName.get("Acme C")!, sort_order: 3 },
      { base_id: baseId, field_id: dealsLinkId, from_record_id: globex.id, to_record_id: byName.get("Globex A")!, sort_order: 1 },
    ])
  );
});

afterAll(async () => {
  await deleteUser(alice);
});

// ─── Links ──────────────────────────────────────────────────────────────────

describe("link", () => {
  it("resolves to [{id, label}], labelled by the target's primary field", async () => {
    const records = await query(alice.db, companies);
    const acmeRow = records.find((r) => r.data.fld_name === "Acme")!;

    const linked = acmeRow.data.fld_deals as { id: string; label: string }[];
    expect(linked).toHaveLength(3);
    // The label is what a record calls itself when something else refers to it —
    // the target table's primary field.
    expect(linked.map((l) => l.label).sort()).toEqual(["Acme A", "Acme B", "Acme C"]);
  });

  it("deleting a linked record removes the edge, not just the row", async () => {
    const extra = must(
      await alice.db
        .from("records")
        .insert({ table_id: deals, base_id: baseId, data: { fld_deal: "Temp", fld_amount: "1" } })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db.from("links").insert({
        base_id: baseId, field_id: dealsLinkId,
        from_record_id: globex.id, to_record_id: extra.id, sort_order: 9,
      })
    );

    await alice.db.from("records").delete().eq("id", extra.id);

    const { data } = await alice.db.from("links").select("id").eq("to_record_id", extra.id);
    expect(data, "a link outlived the record it pointed at").toEqual([]);
  });
});

// ─── Rollup ─────────────────────────────────────────────────────────────────

describe("rollup", () => {
  it("sums across the link, ignoring garbage rather than exploding", async () => {
    // "N/A" lives in Acme C's amount. If the rollup cast it naively, this whole
    // query would throw — and one bad cell would make the table unreadable.
    const id = await makeField(companies, "Total", "fld_total", "rollup", {
      linkFieldId: dealsLinkId,
      targetFieldId: dealAmountId,
      fn: "sum",
    });
    expect(id).toBeTruthy();

    const records = await query(alice.db, companies);
    const byName = new Map(records.map((r) => [r.data.fld_name, r.data]));

    expect(Number(byName.get("Acme")!.fld_total)).toBe(1500); // 1000 + 500, N/A ignored
    expect(Number(byName.get("Globex")!.fld_total)).toBe(300);
  });

  it("IS FILTERABLE — this is the whole point of compiling to SQL", async () => {
    // Nobody wrote "filter by rollup". The rollup is an expression; the filter
    // compiler points at expressions. Resolve rollups in JavaScript instead and
    // this is impossible — you'd have to fetch every row to know which ones match.
    const records = await query(alice.db, companies, {
      filter: { field: "fld_total", op: "gt", value: 1000 },
    });

    expect(records.map((r) => r.data.fld_name)).toEqual(["Acme"]);
  });

  it("IS SORTABLE, for the same reason", async () => {
    const records = await query(alice.db, companies, {
      sort: [{ field: "fld_total", dir: "desc" }],
    });

    expect(records.map((r) => r.data.fld_name)).toEqual(["Acme", "Globex"]);
  });

  it("counts, averages, mins and maxes", async () => {
    await makeField(companies, "Deals count", "fld_n", "rollup", {
      linkFieldId: dealsLinkId, fn: "count",
    });
    await makeField(companies, "Biggest", "fld_max", "rollup", {
      linkFieldId: dealsLinkId, targetFieldId: dealAmountId, fn: "max",
    });

    const records = await query(alice.db, companies);
    const acmeRow = records.find((r) => r.data.fld_name === "Acme")!;

    expect(Number(acmeRow.data.fld_n)).toBe(3);
    expect(Number(acmeRow.data.fld_max)).toBe(1000);
  });
});

// ─── Lookup ─────────────────────────────────────────────────────────────────

describe("lookup", () => {
  it("pulls a field across the link, as an ARRAY", async () => {
    // A many-link has many values. Collapsing that to one would be a lie.
    await makeField(companies, "Deal names", "fld_dealnames", "lookup", {
      linkFieldId: dealsLinkId,
      targetFieldId: dealNameId,
    });

    const records = await query(alice.db, companies);
    const acmeRow = records.find((r) => r.data.fld_name === "Acme")!;

    expect(acmeRow.data.fld_dealnames).toEqual(["Acme A", "Acme B", "Acme C"]);
  });

  it("is searchable — typing a linked record's name finds the parent", async () => {
    const records = await query(alice.db, companies, { search: "Globex A" });
    expect(records.map((r) => r.data.fld_name)).toEqual(["Globex"]);
  });
});

// ─── Formula ────────────────────────────────────────────────────────────────

describe("formula", () => {
  it("computes over this record's fields", async () => {
    await makeField(deals, "Doubled", "fld_doubled", "formula", {
      ast: {
        t: "bin",
        op: "*",
        l: { t: "field", id: dealAmountId },
        r: { t: "num", v: 2 },
      },
    });

    const records = await query(alice.db, deals);
    const a = records.find((r) => r.data.fld_deal === "Acme A")!;
    const bad = records.find((r) => r.data.fld_deal === "Acme C")!;

    expect(Number(a.data.fld_doubled)).toBe(2000);
    // "N/A" * 2 is NULL, not an exception. One bad cell must not fail the page.
    expect(bad.data.fld_doubled).toBeNull();
  });

  it("survives a field RENAME, because it references the field by ID", async () => {
    // The formula above was written against dealAmountId. Rename the column and
    // it must keep working — no formula ever knew it was called "Amount".
    must(
      await alice.db.from("fields").update({ name: "Contract value" }).eq("id", dealAmountId)
    );

    const records = await query(alice.db, deals);
    const a = records.find((r) => r.data.fld_deal === "Acme A")!;

    expect(Number(a.data.fld_doubled)).toBe(2000);
  });

  it("can reference a ROLLUP — formulas compile after the fields they depend on", async () => {
    // The catalog builds in passes precisely so this works: pass 1 resolves the
    // rollup, a later pass resolves the formula that reads it.
    await makeField(companies, "Total + 1", "fld_plus", "formula", {
      ast: {
        t: "bin",
        op: "+",
        l: { t: "field", id: (await fieldIdByKey(companies, "fld_total"))! },
        r: { t: "num", v: 1 },
      },
    });

    const records = await query(alice.db, companies);
    const acmeRow = records.find((r) => r.data.fld_name === "Acme")!;

    expect(Number(acmeRow.data.fld_plus)).toBe(1501);
  });

  it("IS FILTERABLE", async () => {
    const records = await query(alice.db, deals, {
      filter: { field: "fld_doubled", op: "gt", value: 1500 },
    });
    expect(records.map((r) => r.data.fld_deal)).toEqual(["Acme A"]);
  });

  it("divides by zero without taking the query down", async () => {
    await makeField(deals, "Div", "fld_div", "formula", {
      ast: {
        t: "bin",
        op: "/",
        l: { t: "field", id: dealAmountId },
        r: { t: "num", v: 0 },
      },
    });

    const records = await query(alice.db, deals);
    expect(records).toHaveLength(4); // the query survived
    expect(records[0].data.fld_div).toBeNull(); // and the cell is simply blank
  });

  it("a CIRCULAR formula renders blank instead of hanging the database", async () => {
    // The catalog gives up after N passes and emits a null expression. A cycle
    // must not be able to make the table unreadable, let alone spin a backend.
    const a = await makeField(deals, "Cyc A", "fld_cyc_a", "formula", {});
    const b = await makeField(deals, "Cyc B", "fld_cyc_b", "formula", {
      ast: { t: "field", id: a },
    });
    must(
      await alice.db
        .from("fields")
        .update({ options: { ast: { t: "field", id: b } } })
        .eq("id", a)
    );

    const records = await query(alice.db, deals);

    expect(records).toHaveLength(4);
    expect(records[0].data.fld_cyc_a).toBeNull();
    expect(records[0].data.fld_cyc_b).toBeNull();

    // Clean up, so the later tests aren't reading a table full of broken formulas.
    await alice.db.from("fields").delete().in("id", [a, b]);
  });

  it("a BROKEN formula does not make the table unreadable", async () => {
    const broken = await makeField(deals, "Broken", "fld_broken", "formula", {
      ast: { t: "field", id: "00000000-0000-0000-0000-000000000000" },
    });

    const records = await query(alice.db, deals);
    expect(records).toHaveLength(4);
    expect(records[0].data.fld_broken).toBeNull();

    await alice.db.from("fields").delete().eq("id", broken);
  });
});

async function fieldIdByKey(tableId: string, key: string): Promise<string | null> {
  const { data } = await alice.db
    .from("fields")
    .select("id")
    .eq("table_id", tableId)
    .eq("key", key)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

// ─── What a write recomputed ────────────────────────────────────────────────

describe("swamp_computed_values", () => {
  // A formula's value exists nowhere on disk — the query engine derives it at read
  // time from `records.data`, which holds stored scalars only. So after a write the
  // client cannot know it and has to ask. This is that ask.
  //
  // The load-bearing property is what it does NOT return: scalars. Echoing those
  // back would race the undo stack and the user's own typing, which is why the
  // second test here matters more than the first.
  let tableId: string;
  let recId: string;

  beforeAll(async () => {
    const t = must(
      await alice.db
        .from("tables")
        .insert({ base_id: baseId, name: "Computed" })
        .select()
        .single()
    ) as { id: string };
    tableId = t.id;

    const nId = await makeField(tableId, "N", "fld_n", "number", {}, true);

    // Total = N * 2. The AST references the field by ID, never by name — which is
    // what makes renaming free.
    await makeField(tableId, "Total", "fld_total", "formula", {
      ast: { t: "bin", op: "*", l: { t: "field", id: nId }, r: { t: "num", v: 2 } },
    });

    const r = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_n: 5 } })
        .select()
        .single()
    ) as { id: string };
    recId = r.id;
  });

  it("returns the formula's value as it stands now", async () => {
    const { data } = await alice.db.rpc("swamp_computed_values", {
      p_table_id: tableId,
      p_ids: [recId],
    });

    expect(data).toHaveLength(1);
    expect((data as { values: Record<string, unknown> }[])[0].values.fld_total).toBe(10);
  });

  it("returns COMPUTED keys only — never the scalar that was written", async () => {
    // The whole safety argument. A scalar coming back could land on top of newer
    // typing, or on top of an undo, and put the old value under the cursor.
    const { data } = await alice.db.rpc("swamp_computed_values", {
      p_table_id: tableId,
      p_ids: [recId],
    });

    expect(Object.keys((data as { values: object }[])[0].values)).toEqual(["fld_total"]);
  });

  it("recomputes after a patch", async () => {
    must(
      await alice.db.rpc("swamp_patch_records", {
        p_table_id: tableId,
        p_patches: [{ id: recId, values: { fld_n: 7 } }],
      })
    );

    const { data } = await alice.db.rpc("swamp_computed_values", {
      p_table_id: tableId,
      p_ids: [recId],
    });

    expect((data as { values: Record<string, unknown> }[])[0].values.fld_total).toBe(14);
  });

  it("a table with no computed fields returns [] without touching the heap", async () => {
    // The common table. It must cost one catalog read and no query at all.
    const plain = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Plain" }).select().single()
    ) as { id: string };
    await makeField(plain.id, "Name", "fld_name", "text", {}, true);

    const rec = must(
      await alice.db
        .from("records")
        .insert({ table_id: plain.id, base_id: baseId, data: { fld_name: "x" } })
        .select()
        .single()
    ) as { id: string };

    const { data } = await alice.db.rpc("swamp_computed_values", {
      p_table_id: plain.id,
      p_ids: [rec.id],
    });
    expect(data).toEqual([]);
  });

  it("cannot be used to read a table you have no access to", async () => {
    // SECURITY INVOKER, so RLS applies. The catalog fails closed first.
    const mallory = await createUser();
    try {
      const { error } = await mallory.db.rpc("swamp_computed_values", {
        p_table_id: tableId,
        p_ids: [recId],
      });
      expect(error).not.toBeNull();
    } finally {
      await deleteUser(mallory);
    }
  });

  it("is not reachable by anon", async () => {
    // Postgres grants EXECUTE to PUBLIC by default and anon inherits it, so
    // `revoke from anon` alone does nothing — the migration revokes from PUBLIC too.
    // This asserts the revoke actually took.
    const { data } = await alice.db.rpc("swamp_can", { p_base_id: baseId, p_min: "viewer" });
    expect(data).toBe(true); // sanity: the helper works at all

    const { error } = await anon().rpc("swamp_computed_values", {
      p_table_id: tableId,
      p_ids: [recId],
    });
    expect(error).not.toBeNull();
  });
});

// ─── Phase-2 formula library additions ──────────────────────────────────────
//
// One formula field per function, LITERAL args, value asserted. This is the
// test that catches a TS name with no SQL arm: swamp_field_catalog swallows
// per-formula exceptions across passes, so a broken arm is a silently-null
// column — never an error. Assert values, not absence of error.

describe("formula library (NocoDB-parity additions)", () => {
  const num = (v: number) => ({ t: "num", v });
  const str = (v: string) => ({ t: "str", v });
  const bool = (v: boolean) => ({ t: "bool", v });
  const call = (fn: string, ...args: object[]) => ({ t: "call", fn, args });

  // name → [key, ast, expected]; expected compared after Number() for numerics.
  const cases: [string, object, unknown][] = [
    ["fld_p2_switch", call("SWITCH", str("b"), str("a"), num(1), str("b"), num(2), num(99)), 2],
    ["fld_p2_xor1", call("XOR", bool(true), bool(false)), true],
    ["fld_p2_xor2", call("XOR", bool(true), bool(true)), false],
    ["fld_p2_repeat", call("REPEAT", str("ab"), num(3)), "ababab"],
    ["fld_p2_urlenc", call("URLENCODE", str("a b&c")), "a%20b%26c"],
    ["fld_p2_rem", call("REGEX_MATCH", str("hello"), str("l+")), true],
    ["fld_p2_rex", call("REGEX_EXTRACT", str("v1.22.3"), str("[0-9]+")), "1"],
    ["fld_p2_rer", call("REGEX_REPLACE", str("aaa"), str("a"), str("b")), "bbb"],
    ["fld_p2_md5", call("MD5", str("abc")), "900150983cd24fb0d6963f7d28e17f72"],
    ["fld_p2_even", call("EVEN", num(3)), 4],
    ["fld_p2_evenneg", call("EVEN", num(-1)), -2],
    ["fld_p2_odd", call("ODD", num(4)), 5],
    ["fld_p2_rdown", call("ROUNDDOWN", num(1.97), num(1)), 1.9],
    ["fld_p2_rup", call("ROUNDUP", num(1.01), num(1)), 1.1],
    ["fld_p2_int", call("INT", num(1.9)), 1],
    ["fld_p2_value", call("VALUE", str("12.5")), 12.5],
    ["fld_p2_log10", call("LOG", num(100)), 2],
    ["fld_p2_log2", call("LOG", num(8), num(2)), 3],
    ["fld_p2_exp", call("EXP", num(0)), 1],
    ["fld_p2_arrsort", call("ARRAYSORT", str('["b","a"]')), ["a", "b"]],
    ["fld_p2_arruniq", call("ARRAYUNIQUE", str('["b","a","b"]')), ["a", "b"]],
    ["fld_p2_arrcomp", call("ARRAYCOMPACT", str('["a","",null,"b"]')), ["a", "b"]],
    ["fld_p2_arrslice", call("ARRAYSLICE", str('["a","b","c","d"]'), num(2), num(3)), ["b", "c"]],
    ["fld_p2_counta", call("COUNTA", str("a"), str(""), str("b")), 2],
    ["fld_p2_countaarr", call("COUNTA", str('["a","b","c"]')), 3],
    ["fld_p2_count", call("COUNT", str("x"), num(5), str("7")), 2],
    ["fld_p2_countall", call("COUNTALL", str(""), str("a")), 2],
    ["fld_p2_dtdays", call("DATETIME_DIFF", str("2026-01-11"), str("2026-01-01"), str("days")), 10],
    ["fld_p2_dtmonths", call("DATETIME_DIFF", str("2026-03-15"), str("2026-01-15"), str("months")), 2],
    ["fld_p2_hour", call("HOUR", str("2026-01-01 13:45:30")), 13],
    ["fld_p2_minute", call("MINUTE", str("2026-01-01 13:45:30")), 45],
    ["fld_p2_second", call("SECOND", str("2026-01-01 13:45:30")), 30],
  ];

  it("computes the documented value for every new function", async () => {
    for (const [key, ast] of cases) {
      await makeField(deals, key, key, "formula", { ast });
    }

    const records = await query(alice.db, deals);
    const r = records[0];

    for (const [key, , expected] of cases) {
      const got = r.data[key];
      if (typeof expected === "number") {
        expect(Number(got), key).toBe(expected);
      } else if (typeof expected === "boolean") {
        expect(got, key).toBe(expected);
      } else if (Array.isArray(expected)) {
        expect(got, key).toEqual(expected);
      } else {
        expect(got, key).toBe(expected);
      }
    }
  });
});
