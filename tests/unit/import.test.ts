import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { flatten, parseCSV, parseJSON, parseXLSX } from "@/features/tables/engine/import";

// Parsing a file into columns and rows.
//
// This file used to say the XLSX path "is covered by the e2e import test". It was
// not: no e2e test ever mentioned xlsx and no .xlsx fixture existed anywhere in the
// repo. parseXLSX — the only parser here that reads untrusted BINARY, and the one
// whose library was swapped from the abandoned npm `xlsx@0.18.5` to SheetJS's own
// `0.20.3` — had no test at all, behind a comment saying otherwise.
//
// The workbooks below are built with XLSX.write and read back through parseXLSX, so
// they exercise the real library rather than a mock of what we hope it does.

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

// ─── parseXLSX ──────────────────────────────────────────────────────────────

/** Cells → a real .xlsx → the ArrayBuffer parseXLSX is handed in production. */
function workbook(cells: Record<string, XLSX.CellObject>, ref: string): ArrayBuffer {
  const ws: XLSX.WorkSheet = { ...cells, "!ref": ref };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true });
  return out as ArrayBuffer;
}

const txt = (v: string): XLSX.CellObject => ({ t: "s", v });
const num = (v: number, z?: string): XLSX.CellObject => ({ t: "n", v, ...(z ? { z } : {}) });

describe("parseXLSX", () => {
  it("takes the first row as headers and reads the rest", () => {
    const t = parseXLSX(
      workbook(
        { A1: txt("Name"), B1: txt("Qty"), A2: txt("Alpha"), B2: num(1) },
        "A1:B2"
      )
    );
    expect(t.columns).toEqual(["Name", "Qty"]);
    expect(t.rows).toEqual([{ Name: "Alpha", Qty: 1 }]);
  });

  it("names blank headers and de-dupes repeats instead of losing columns", () => {
    // Two columns named "Name" would collapse into one key and silently drop a
    // column's data — every row's second Name overwriting the first.
    const t = parseXLSX(
      workbook(
        {
          A1: txt("Name"), B1: txt(""), C1: txt("Name"),
          A2: txt("a"),    B2: txt("b"), C2: txt("c"),
        },
        "A1:C2"
      )
    );
    expect(t.columns).toHaveLength(3);
    expect(new Set(t.columns).size).toBe(3);
    expect(t.columns[1]).toBe("col_2"); // blank header → positional name
    expect(Object.values(t.rows[0])).toEqual(["a", "b", "c"]);
  });

  it("skips error cells rather than importing their error code as a number", () => {
    // A #DIV/0! cell carries a NUMERIC error code in .v (0x07). Taken at face value
    // it lands in the column as the number 7 and can flip the column's inferred type.
    //
    // The error cell sits next to a real one, so its ROW survives — that is what
    // makes this test about error cells rather than about blank-row dropping.
    const t = parseXLSX(
      workbook(
        {
          A1: txt("Name"),  B1: txt("Ratio"),
          A2: txt("Alpha"), B2: num(1.5),
          A3: txt("Bravo"), B3: { t: "e", v: 0x07 } as XLSX.CellObject, // #DIV/0!
          A4: txt("Charlie"), B4: num(2.5),
        },
        "A1:B4"
      )
    );
    expect(t.rows.map((r) => r.Ratio)).toEqual([1.5, "", 2.5]);
    // The row is kept — only the error cell is emptied.
    expect(t.rows.map((r) => r.Name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("drops a row whose only content is an error cell", () => {
    // The other half of the rule above: an error cell counts as empty, so a row with
    // nothing but errors is a blank row and goes. Discovered by getting this
    // backwards in the test first.
    const t = parseXLSX(
      workbook(
        {
          A1: txt("Ratio"),
          A2: num(1.5),
          A3: { t: "e", v: 0x07 } as XLSX.CellObject,
        },
        "A1:A3"
      )
    );
    expect(t.rows.map((r) => r.Ratio)).toEqual([1.5]);
  });

  it("reads a real Date rather than an Excel serial number", () => {
    // cellDates:true. Without it a date arrives as 45000-ish and imports as a number.
    const ws: XLSX.WorkSheet = {
      A1: txt("When"),
      A2: { t: "d", v: new Date(2026, 6, 16), z: "yyyy-mm-dd" } as XLSX.CellObject,
      "!ref": "A1:A2",
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, {
      type: "array", bookType: "xlsx", cellDates: true, cellStyles: true,
    }) as ArrayBuffer;

    expect(parseXLSX(buf).rows[0].When).toBe("2026-07-16");
  });

  it("reads currency from the cell FORMAT, not from the characters in the value", () => {
    // The whole reason cellNF is on. A currency column typed as plain numbers has no
    // $ anywhere in its values — the money lives in the number format. Without this
    // hint the column imports as a bare number and the currency is gone.
    const t = parseXLSX(
      workbook(
        {
          A1: txt("Amount"),
          A2: num(1200, '"$"#,##0.00'),
          A3: num(950, '"$"#,##0.00'),
        },
        "A1:A3"
      )
    );
    expect(t.formatHints?.Amount).toMatchObject({ currency: true });
  });

  it("reads percent from the cell format", () => {
    // Excel stores 25% as 0.25. The format is the only thing that says "percent".
    const t = parseXLSX(
      workbook(
        { A1: txt("Rate"), A2: num(0.25, "0.00%"), A3: num(0.5, "0.00%") },
        "A1:A3"
      )
    );
    expect(t.formatHints?.Rate).toMatchObject({ percent: true });
    expect(t.formatHints?.Rate?.currency).toBeUndefined();
  });

  it("gives no hint for a column that is just numbers", () => {
    const t = parseXLSX(
      workbook({ A1: txt("Qty"), A2: num(1), A3: num(2) }, "A1:A3")
    );
    expect(t.formatHints?.Qty).toBeUndefined();
  });

  it("returns an empty table for a sheet with no cells, rather than throwing", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, {}, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    expect(parseXLSX(buf)).toEqual({ columns: [], rows: [], formatHints: {} });
  });

  it("drops entirely blank rows", () => {
    const t = parseXLSX(
      workbook(
        { A1: txt("Name"), A2: txt("Alpha"), A4: txt("Charlie") },
        "A1:A4"
      )
    );
    expect(t.rows.map((r) => r.Name)).toEqual(["Alpha", "Charlie"]);
  });
});
