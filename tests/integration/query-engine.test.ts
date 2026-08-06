import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Phase 1b — the query engine, against a real Postgres.
//
// The compiler builds dynamic SQL from client-supplied JSON. That makes two
// things worth proving beyond "does it return the right rows":
//
//   • It cannot be injected. A field name is only ever emitted from the field
//     catalog, so a made-up name has nowhere to go.
//   • Pagination is stable under concurrent writes. OFFSET is not; keyset is.
//     This is the bug that shows a reader row X twice and never shows them row Y,
//     and it cannot be reproduced on demand once it's in production.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let bob: TestUser;
let tableId: string;
let baseId: string;

type Spec = Record<string, unknown>;
type Rec = { id: string; data: Record<string, unknown>; sortOrder: string };
type QueryResult = { records: Rec[]; next: unknown };

async function query(db: SupabaseClient, spec: Spec = {}, id = tableId): Promise<QueryResult> {
  const { data, error } = await db.rpc("swamp_query_records", { p_table_id: id, p_spec: spec });
  if (error) throw new Error(error.message);
  return data as QueryResult;
}

async function count(db: SupabaseClient, spec: Spec = {}, id = tableId): Promise<number> {
  const { data, error } = await db.rpc("swamp_count_records", { p_table_id: id, p_spec: spec });
  if (error) throw new Error(error.message);
  return data as number;
}

/** Names of the matching rows, in the order the engine returned them. */
async function names(spec: Spec = {}): Promise<string[]> {
  const { records } = await query(alice.db, spec);
  return records.map((r) => r.data.fld_name as string);
}

const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
};

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Query" })
      .select()
      .single()
  ) as { id: string };
  const table = must(
    await alice.db
      .from("tables")
      .insert({ base_id: base.id, name: "Deals" })
      .select()
      .single()
  ) as { id: string };
  tableId = table.id;
  baseId = base.id;

  // NOTE: every object in a bulk insert must carry the SAME keys. PostgREST
  // takes the union of keys across the array and sends NULL for any a given row
  // omits — it does NOT fall back to the column default. So leaving `is_primary`
  // off the last five rows sends `is_primary: null`, which trips the NOT NULL.
  // Silent, surprising, and it only bites on bulk inserts.
  must(
    await alice.db.from("fields").insert([
      { table_id: tableId, base_id: base.id, name: "Name",   key: "fld_name",   type: "text",        is_primary: true  },
      { table_id: tableId, base_id: base.id, name: "Amount", key: "fld_amount", type: "currency",    is_primary: false },
      { table_id: tableId, base_id: base.id, name: "Status", key: "fld_status", type: "status",      is_primary: false },
      { table_id: tableId, base_id: base.id, name: "Due",    key: "fld_due",    type: "date",        is_primary: false },
      { table_id: tableId, base_id: base.id, name: "Tags",   key: "fld_tags",   type: "multiSelect", is_primary: false },
      { table_id: tableId, base_id: base.id, name: "Won",    key: "fld_won",    type: "boolean",     is_primary: false },
    ])
  );

  must(
    await alice.db.from("records").insert([
      { table_id: tableId, base_id: base.id, sort_order: 1, data: { fld_name: "Acme",     fld_amount: "1000",  fld_status: "open",   fld_due: day(3),   fld_tags: ["a", "b"], fld_won: "false" } },
      { table_id: tableId, base_id: base.id, sort_order: 2, data: { fld_name: "Beta",     fld_amount: "500",   fld_status: "open",   fld_due: day(-3),  fld_tags: ["b"],      fld_won: "true"  } },
      { table_id: tableId, base_id: base.id, sort_order: 3, data: { fld_name: "Ceres",    fld_amount: "2500",  fld_status: "closed", fld_due: day(30),  fld_tags: ["c"],      fld_won: "true"  } },
      { table_id: tableId, base_id: base.id, sort_order: 4, data: { fld_name: "Delta",    fld_amount: "N/A",   fld_status: "open",   fld_due: null,     fld_tags: [],         fld_won: "false" } },
      { table_id: tableId, base_id: base.id, sort_order: 5, data: { fld_name: "Everest",  fld_amount: "",      fld_status: "",       fld_due: day(0),   fld_tags: ["a", "c"], fld_won: null    } },
    ])
  );
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

// ─── Security ───────────────────────────────────────────────────────────────

describe("security", () => {
  it("refuses to query a table the caller cannot read", async () => {
    // SECURITY INVOKER, so RLS applies. Bob knows the table id and asks anyway.
    await expect(query(bob.db, {})).rejects.toThrow();
  });

  it("rejects a field name that isn't in the catalog", async () => {
    // The field map is the injection boundary. A name that isn't in it has
    // nowhere to go — it never reaches the generated SQL.
    await expect(
      query(alice.db, { filter: { field: "fld_nope", op: "eq", value: "x" } })
    ).rejects.toThrow(/unknown field/);
  });

  it("does not let a crafted field name inject SQL", async () => {
    const injections = [
      "fld_name') = 'x' or '1'='1",
      "fld_name'; drop table public.records; --",
      "*",
    ];
    for (const field of injections) {
      await expect(
        query(alice.db, { filter: { field, op: "eq", value: "x" } })
      ).rejects.toThrow(/unknown field/);
    }

    // And the table is still there.
    expect(await count(alice.db)).toBe(5);
  });

  it("treats a hostile VALUE as data, not code", async () => {
    // Values are quote_literal'd, so this is just a string nobody matches.
    const { records } = await query(alice.db, {
      filter: { field: "fld_name", op: "eq", value: "'; drop table public.records; --" },
    });
    expect(records).toEqual([]);
    expect(await count(alice.db)).toBe(5);
  });

  it("rejects an unknown operator", async () => {
    await expect(
      query(alice.db, { filter: { field: "fld_name", op: "haxx", value: "x" } })
    ).rejects.toThrow(/unknown operator/);
  });

  it("caps filter nesting depth", async () => {
    let node: Spec = { field: "fld_name", op: "eq", value: "Acme" };
    for (let i = 0; i < 15; i++) node = { op: "and", children: [node] };
    await expect(query(alice.db, { filter: node })).rejects.toThrow(/too deep/);
  });
});

// ─── Operators ──────────────────────────────────────────────────────────────

describe("operators", () => {
  it("eq / neq on text", async () => {
    expect(await names({ filter: { field: "fld_name", op: "eq", value: "Acme" } })).toEqual(["Acme"]);
  });

  it("neq includes empty cells — a blank is not equal to 'open'", async () => {
    // The classic bug: `expr <> 'open'` is NULL for a null cell, which isn't
    // true, so plain <> silently drops every blank row. Users are quite sure a
    // blank cell is not equal to "open". IS DISTINCT FROM gets this right.
    const result = await names({ filter: { field: "fld_status", op: "neq", value: "open" } });
    expect(result).toContain("Ceres");    // "closed"
    expect(result).toContain("Everest");  // ""
    expect(result).not.toContain("Acme");
  });

  it("numeric comparison ignores garbage values instead of exploding", async () => {
    // "N/A" lives in Delta's amount. A naive ::numeric cast would throw and take
    // the entire query down. It should simply not match.
    expect(await names({ filter: { field: "fld_amount", op: "gt", value: 900 } }))
      .toEqual(["Acme", "Ceres"]);
  });

  it("btw", async () => {
    expect(await names({ filter: { field: "fld_amount", op: "btw", value: [400, 1200] } }))
      .toEqual(["Acme", "Beta"]);
  });

  it("nbtw is NULL-safe — a blank or garbage cell IS 'not between'", async () => {
    // The complement of btw PLUS the rows whose amount is missing or "N/A":
    // like neq/nanyof, absence satisfies a negative operator.
    const result = await names({
      filter: { field: "fld_amount", op: "nbtw", value: [400, 1200] },
    });
    expect(result).not.toContain("Acme");
    expect(result).not.toContain("Beta");
    expect(result).toContain("Delta"); // "N/A" → swamp_to_numeric NULL → matches
  });

  it("like is case-insensitive", async () => {
    expect(await names({ filter: { field: "fld_name", op: "like", value: "ACM" } })).toEqual(["Acme"]);
  });

  it("empty / notempty treat a missing key and an empty string alike", async () => {
    expect(await names({ filter: { field: "fld_status", op: "empty" } })).toEqual(["Everest"]);
    expect(await names({ filter: { field: "fld_due", op: "empty" } })).toEqual(["Delta"]);
  });

  it("anyof on a select", async () => {
    expect(await names({ filter: { field: "fld_status", op: "anyof", value: ["closed"] } }))
      .toEqual(["Ceres"]);
  });

  it("anyof / allof on a multiSelect", async () => {
    expect(await names({ filter: { field: "fld_tags", op: "anyof", value: ["a"] } }))
      .toEqual(["Acme", "Everest"]);
    expect(await names({ filter: { field: "fld_tags", op: "allof", value: ["a", "c"] } }))
      .toEqual(["Everest"]);
  });

  it("checked / notchecked on a boolean", async () => {
    expect(await names({ filter: { field: "fld_won", op: "checked" } })).toEqual(["Beta", "Ceres"]);
  });
});

// ─── Relative dates ─────────────────────────────────────────────────────────

describe("relative date windows", () => {
  it("resolves 'today' at query time", async () => {
    expect(await names({ filter: { field: "fld_due", op: "eq", subOp: "today" } }))
      .toEqual(["Everest"]);
  });

  it("isWithin the next N days", async () => {
    // Acme is due in 3 days, Everest today. Ceres (30 days) must not appear —
    // this is the assertion that catches an off-by-one in the window bounds.
    expect(await names({
      filter: { field: "fld_due", op: "isWithin", subOp: "nextNumberOfDays", n: 7 },
    })).toEqual(["Acme", "Everest"]);
  });

  it("isWithin the past week", async () => {
    expect(await names({
      filter: { field: "fld_due", op: "isWithin", subOp: "pastWeek" },
    })).toEqual(["Beta", "Everest"]);
  });

  it("rejects isWithin without a valid subOp", async () => {
    await expect(
      query(alice.db, { filter: { field: "fld_due", op: "isWithin" } })
    ).rejects.toThrow(/subOp/);
  });
});

// ─── Filter trees ───────────────────────────────────────────────────────────

describe("filter trees", () => {
  it("ands", async () => {
    expect(await names({
      filter: {
        op: "and",
        children: [
          { field: "fld_status", op: "eq", value: "open" },
          { field: "fld_amount", op: "gte", value: 600 },
        ],
      },
    })).toEqual(["Acme"]);
  });

  it("ors", async () => {
    expect(await names({
      filter: {
        op: "or",
        children: [
          { field: "fld_name", op: "eq", value: "Acme" },
          { field: "fld_name", op: "eq", value: "Ceres" },
        ],
      },
    })).toEqual(["Acme", "Ceres"]);
  });

  it("nests groups inside groups", async () => {
    // status = open AND (amount > 900 OR name = 'Delta')
    expect(await names({
      filter: {
        op: "and",
        children: [
          { field: "fld_status", op: "eq", value: "open" },
          {
            op: "or",
            children: [
              { field: "fld_amount", op: "gt", value: 900 },
              { field: "fld_name", op: "eq", value: "Delta" },
            ],
          },
        ],
      },
    })).toEqual(["Acme", "Delta"]);
  });

  it("nots", async () => {
    expect(await names({
      filter: { op: "not", children: [{ field: "fld_status", op: "eq", value: "open" }] },
    })).toEqual(["Ceres", "Everest"]);
  });

  it("an empty group filters nothing", async () => {
    expect(await names({ filter: { op: "and", children: [] } })).toHaveLength(5);
  });
});

// ─── Search ─────────────────────────────────────────────────────────────────

describe("search", () => {
  it("matches across text fields, case-insensitively", async () => {
    expect(await names({ search: "ere" })).toEqual(["Ceres", "Everest"]);
  });

  it("does not match numbers or dates", async () => {
    expect(await names({ search: "1000" })).toEqual([]);
  });
});

// ─── Sorting ────────────────────────────────────────────────────────────────

describe("sorting", () => {
  it("sorts by a numeric field ascending", async () => {
    expect(await names({ sort: [{ field: "fld_amount", dir: "asc" }] }))
      .toEqual(["Beta", "Acme", "Ceres", "Delta", "Everest"]);
    // Delta ("N/A") and Everest ("") coerce to null → nulls last, then the
    // tiebreaker decides between them.
  });

  it("puts nulls last on DESC too", async () => {
    // Postgres defaults to nulls-FIRST on DESC, which floats every blank cell to
    // the top of a Z→A sort and looks like a bug to anyone using it.
    const result = await names({ sort: [{ field: "fld_amount", dir: "desc" }] });
    expect(result.slice(0, 3)).toEqual(["Ceres", "Acme", "Beta"]);
    expect(result.slice(3).sort()).toEqual(["Delta", "Everest"]);
  });

  it("sorts by multiple fields in precedence order", async () => {
    // Status ascending is the primary key, amount descending the tiebreaker.
    // Everest's status is BLANK, and a blank text cell currently sorts to the top
    // of an A→Z sort (an empty string is "less than" any real word) — so it leads.
    // Then Ceres ("closed") < the three "open" rows, which the amount tiebreaker
    // orders 1000 > 500 > null. That's precedence working; the blank landing first
    // rather than last is a cosmetic default we may flip later.
    expect(await names({
      sort: [
        { field: "fld_status", dir: "asc" },
        { field: "fld_amount", dir: "desc" },
      ],
    })).toEqual(["Everest", "Ceres", "Acme", "Beta", "Delta"]);
  });

  it("rejects a sort on an unknown field", async () => {
    await expect(
      query(alice.db, { sort: [{ field: "fld_nope", dir: "asc" }] })
    ).rejects.toThrow(/unknown field/);
  });
});

// ─── Pagination ─────────────────────────────────────────────────────────────

describe("keyset pagination", () => {
  it("walks every row exactly once, with no cursor on the final page", async () => {
    const seen: string[] = [];
    let cursor: unknown = null;

    for (let page = 0; page < 10; page++) {
      const res: QueryResult = await query(alice.db, { limit: 2, cursor });
      seen.push(...res.records.map((r) => r.data.fld_name as string));
      cursor = res.next;
      if (!cursor) break;
    }

    expect(seen).toEqual(["Acme", "Beta", "Ceres", "Delta", "Everest"]);
  });

  it("walks a SORTED result exactly once", async () => {
    // The interesting case. Anchoring the cursor on (sort_order, id) alone is
    // wrong the moment a user sort is active — the anchor has to be the whole
    // ordering tuple, or pages overlap and skip.
    const sort = [{ field: "fld_amount", dir: "desc" }];
    const seen: string[] = [];
    let cursor: unknown = null;

    for (let page = 0; page < 10; page++) {
      const res: QueryResult = await query(alice.db, { sort, limit: 2, cursor });
      seen.push(...res.records.map((r) => r.data.fld_name as string));
      cursor = res.next;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);               // nothing seen twice
    expect(seen.slice(0, 3)).toEqual(["Ceres", "Acme", "Beta"]);
  });

  it("does not smear the window when a row is inserted mid-walk", async () => {
    // THE bug OFFSET has. Read page 1, insert a row that sorts ABOVE the window,
    // then read page 2. With OFFSET, everything shifts down by one and you see
    // the last row of page 1 all over again. Keyset anchors on the row you
    // actually saw, so it can't.
    const baseId = must(
      await alice.db.from("tables").select("base_id").eq("id", tableId).single()
    ) as { base_id: string };

    const page1 = await query(alice.db, { limit: 2 });
    expect(page1.records.map((r) => r.data.fld_name)).toEqual(["Acme", "Beta"]);

    const intruder = must(
      await alice.db
        .from("records")
        .insert({
          table_id: tableId,
          base_id: baseId.base_id,
          sort_order: 0,                            // sorts ABOVE everything already read
          data: { fld_name: "Intruder" },
        })
        .select()
        .single()
    ) as { id: string };

    try {
      const page2 = await query(alice.db, { limit: 2, cursor: page1.next });
      const seen = page2.records.map((r) => r.data.fld_name);

      expect(seen).not.toContain("Beta");     // no duplicate from page 1
      expect(seen).toEqual(["Ceres", "Delta"]);
    } finally {
      await alice.db.from("records").delete().eq("id", intruder.id);
    }
  });
});

// ─── Count ──────────────────────────────────────────────────────────────────

describe("count", () => {
  it("counts the whole table", async () => {
    expect(await count(alice.db)).toBe(5);
  });

  it("counts through a filter, ignoring limit", async () => {
    const spec = { filter: { field: "fld_status", op: "eq", value: "open" }, limit: 1 };
    expect(await count(alice.db, spec)).toBe(3);
    expect((await query(alice.db, spec)).records).toHaveLength(1);
  });
});

// ─── Soft delete ────────────────────────────────────────────────────────────

describe("soft delete", () => {
  it("excludes deleted records without the caller asking", async () => {
    // The not-deleted predicate lives in the query builder, not at each call
    // site. That is the only way to make it impossible to forget.
    const target = (await query(alice.db, { filter: { field: "fld_name", op: "eq", value: "Beta" } }))
      .records[0];

    must(
      await alice.db
        .from("records")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", target.id)
    );

    try {
      expect(await names()).not.toContain("Beta");
      expect(await count(alice.db)).toBe(4);
    } finally {
      await alice.db.from("records").update({ deleted_at: null }).eq("id", target.id);
    }
  });
});

// ─── Phase-4: field-to-field filters + row colour rules ─────────────────────

describe("field-to-field comparison (valueField)", () => {
  beforeAll(async () => {
    // A second numeric column to compare against.
    must(
      await alice.db.from("fields").insert({
        table_id: tableId,
        base_id: baseId,
        name: "Target",
        key: "fld_target",
        type: "number",
        is_primary: false,
      })
    );

    const { data: rows } = await alice.db
      .from("records")
      .select("id, data")
      .eq("table_id", tableId);

    for (const r of rows ?? []) {
      const d = r.data as Record<string, unknown>;
      const target =
        d.fld_name === "Acme" ? "1200" : d.fld_name === "Beta" ? "300" : null;
      if (target !== null) {
        must(
          await alice.db
            .from("records")
            .update({ data: { ...d, fld_target: target } })
            .eq("id", r.id)
        );
      }
    }
  });

  it("compares one field against another — Actual > Target", async () => {
    // Acme: 1000 vs 1200 (no). Beta: 500 vs 300 (yes). Others: no target → NULL.
    expect(
      await names({ filter: { field: "fld_amount", op: "gt", valueField: "fld_target" } })
    ).toEqual(["Beta"]);
  });

  it("rejects a valueField that is not a real field — the catalog is the boundary", async () => {
    const { error } = await alice.db.rpc("swamp_query_records", {
      p_table_id: tableId,
      p_spec: { filter: { field: "fld_amount", op: "gt", valueField: "fld_made_up" } },
    });
    expect(error).not.toBeNull();
  });

  it("rejects a valueField on an operator that doesn't support it", async () => {
    const { error } = await alice.db.rpc("swamp_query_records", {
      p_table_id: tableId,
      p_spec: { filter: { field: "fld_name", op: "like", valueField: "fld_target" } },
    });
    expect(error).not.toBeNull();
  });
});

describe("swamp_row_colors", () => {
  it("first matching rule wins, evaluated over the given ids only", async () => {
    const { data: rows } = await alice.db
      .from("records")
      .select("id, data")
      .eq("table_id", tableId);
    const byName = new Map((rows ?? []).map((r) => [(r.data as any).fld_name, r.id]));
    const ids = [...byName.values()];

    const { data, error } = await alice.db.rpc("swamp_row_colors", {
      p_table_id: tableId,
      p_record_ids: ids,
      p_rules: [
        { filter: { field: "fld_amount", op: "gt", value: 900 }, color: "amber" },
        { filter: { field: "fld_status", op: "eq", value: "open" }, color: "sky" },
      ],
    });
    expect(error).toBeNull();

    const colors = data as Record<string, string>;
    expect(colors[byName.get("Acme")!]).toBe("amber"); // matches BOTH; first wins
    expect(colors[byName.get("Beta")!]).toBe("sky");
    expect(colors[byName.get("Ceres")!]).toBe("amber");
    expect(colors[byName.get("Delta")!]).toBe("sky"); // "N/A" amount → NULL → rule 2
    expect(colors[byName.get("Everest")!]).toBeUndefined(); // matches nothing
  });

  it("a rule over an unknown field raises rather than guessing", async () => {
    const { data: rows } = await alice.db
      .from("records")
      .select("id")
      .eq("table_id", tableId)
      .limit(1);

    const { error } = await alice.db.rpc("swamp_row_colors", {
      p_table_id: tableId,
      p_record_ids: [rows![0].id],
      p_rules: [{ filter: { field: "fld_nope", op: "eq", value: 1 }, color: "amber" }],
    });
    expect(error).not.toBeNull();
  });
});
