import { describe, expect, it } from "vitest";
import { flatten, parseCSV, parseJSON } from "@/features/tables/engine/import";

// Parsing a file into columns and rows.
//
// The XLSX path needs a real workbook and is covered by the e2e import test; these
// are the two that can be exercised as pure functions.

describe("parseCSV", () => {
  it("takes the first row as headers", () => {
    const t = parseCSV("name,age\nAlice,30\nBob,25");
    expect(t.columns).toEqual(["name", "age"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toEqual({ name: "Alice", age: "30" });
  });

  it("does NOT coerce types while parsing", () => {
    // dynamicTyping is off on purpose. Papa's guess would turn "007" into 7 before
    // inference ever sees it — and inference is the thing that knows "007" with a
    // leading zero belongs in a text column.
    const t = parseCSV("code\n007");
    expect(t.rows[0].code).toBe("007");
  });

  it("handles quoted cells containing commas", () => {
    const t = parseCSV('name,note\nAlice,"a, b"');
    expect(t.rows[0].note).toBe("a, b");
  });

  it("returns no columns for an empty file", () => {
    expect(parseCSV("").columns).toEqual([]);
  });
});

describe("parseJSON", () => {
  it("reads an array of objects", () => {
    const t = parseJSON('[{"a":1,"b":2},{"a":3,"b":4}]');
    expect(t.columns.sort()).toEqual(["a", "b"]);
    expect(t.rows).toHaveLength(2);
  });

  it("finds the array inside a wrapper", () => {
    // Webhook payloads are almost never a bare array. { data: [...] },
    // { records: [...] }, { results: [...] } — all of them, in the wild.
    for (const key of ["data", "rows", "records", "items", "results"]) {
      const t = parseJSON(JSON.stringify({ [key]: [{ a: 1 }] }));
      expect(t.rows, key).toHaveLength(1);
    }
  });

  it("finds an array nested deeper", () => {
    const t = parseJSON(JSON.stringify({ meta: { ok: true }, payload: { list: [{ a: 1 }] } }));
    expect(t.rows).toHaveLength(1);
  });

  it("treats a single object as a one-row table", () => {
    const t = parseJSON('{"a":1,"b":2}');
    expect(t.rows).toHaveLength(1);
    expect(t.columns.sort()).toEqual(["a", "b"]);
  });

  it("unions the keys across rows", () => {
    // Real JSON is ragged. A column that only some rows have must still become a
    // column, or those values vanish.
    const t = parseJSON('[{"a":1},{"b":2}]');
    expect(t.columns.sort()).toEqual(["a", "b"]);
  });
});

describe("flatten", () => {
  it("flattens one level with a dotted key", () => {
    expect(flatten({ user: { name: "a" } })).toEqual({ "user.name": "a" });
  });

  it("stringifies anything deeper rather than exploding the column count", () => {
    // A three-level-deep payload would otherwise produce dozens of columns nobody
    // asked for. One level is the useful depth; below that, keep it as JSON and let
    // the user decide.
    const result = flatten({ a: { b: { c: 1 } } });
    expect(typeof result["a.b"]).toBe("string");
    expect(result["a.b"]).toContain("c");
  });

  it("leaves scalars alone", () => {
    expect(flatten({ a: 1, b: "x", c: null })).toEqual({ a: 1, b: "x", c: null });
  });
});
