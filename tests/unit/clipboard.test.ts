import { describe, expect, it } from "vitest";
import {
  coercePasted,
  fillSeries,
  fromTSV,
  toTSV,
} from "@/features/tables/clipboard";

// TSV is what Excel and Google Sheets put on the clipboard. Get it right and a
// user can copy a block out of a spreadsheet and paste it straight in. Get it
// wrong and the grid is an island.

describe("toTSV", () => {
  it("joins cells with tabs and rows with newlines", () => {
    expect(toTSV([["a", "b"], ["c", "d"]])).toBe("a\tb\nc\td");
  });

  it("quotes a cell containing a tab, newline or quote", () => {
    // TSV uses tabs and newlines as delimiters, so a cell containing one has to be
    // quoted — Excel's convention, and the thing naive implementations skip right
    // before they silently corrupt every long-text field.
    expect(toTSV([["a\tb"]])).toBe('"a\tb"');
    expect(toTSV([["line1\nline2"]])).toBe('"line1\nline2"');
    expect(toTSV([['say "hi"']])).toBe('"say ""hi"""');
  });

  it("renders null as empty and an array as a comma list", () => {
    expect(toTSV([[null, ["a", "b"]]])).toBe("\ta, b");
  });
});

describe("fromTSV", () => {
  it("round-trips a plain block", () => {
    const block = [["a", "b"], ["c", "d"]];
    expect(fromTSV(toTSV(block))).toEqual(block);
  });

  it("round-trips a cell containing a newline", () => {
    // The one-liner `text.split("\n").map(l => l.split("\t"))` destroys this, and
    // a long-text field is exactly the thing people paste.
    const block = [["intro", "line1\nline2"], ["x", "y"]];
    expect(fromTSV(toTSV(block))).toEqual(block);
  });

  it("round-trips a cell containing a tab and escaped quotes", () => {
    const block = [['he said "no"\tloudly']];
    expect(fromTSV(toTSV(block))).toEqual(block);
  });

  it("handles CRLF from Windows Excel", () => {
    expect(fromTSV("a\tb\r\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("drops a trailing newline rather than emitting a phantom row", () => {
    expect(fromTSV("a\tb\n")).toEqual([["a", "b"]]);
  });
});

describe("fillSeries", () => {
  it("continues a numeric series", () => {
    // Drag 1, 2 down and you get 3, 4, 5 — not 1, 2, 1, 2. A fill that only ever
    // repeats is a fill people stop using.
    expect(fillSeries(["1", "2"], 3)).toEqual(["3", "4", "5"]);
  });

  it("continues a series with a step other than 1", () => {
    expect(fillSeries(["10", "20"], 2)).toEqual(["30", "40"]);
  });

  it("continues a descending series", () => {
    expect(fillSeries(["5", "4"], 2)).toEqual(["3", "2"]);
  });

  it("does NOT treat a single value as a series", () => {
    // Dragging one "5" down gives 5, 5, 5 — not 6, 7, 8. Two values are needed to
    // establish an intent, and this is the difference between a fill that feels
    // helpful and one that feels possessed.
    expect(fillSeries(["5"], 3)).toEqual(["5", "5", "5"]);
  });

  it("does NOT extrapolate an inconsistent step", () => {
    expect(fillSeries(["1", "2", "5"], 2)).toEqual(["1", "2"]);
  });

  it("continues a date series", () => {
    expect(fillSeries(["2026-07-01", "2026-07-02"], 2)).toEqual([
      "2026-07-03",
      "2026-07-04",
    ]);
  });

  it("continues a weekly date series", () => {
    expect(fillSeries(["2026-07-01", "2026-07-08"], 1)).toEqual(["2026-07-15"]);
  });

  it("repeats anything that isn't a series", () => {
    expect(fillSeries(["open"], 3)).toEqual(["open", "open", "open"]);
    expect(fillSeries(["a", "b"], 4)).toEqual(["a", "b", "a", "b"]);
  });

  it("repeats a constant run rather than incrementing by zero", () => {
    expect(fillSeries(["7", "7"], 2)).toEqual(["7", "7"]);
  });
});

describe("coercePasted", () => {
  it("turns a comma list into an array for a multiSelect", () => {
    // Everything on the clipboard is a string. A multiSelect stores an ARRAY, and
    // pasting the literal string would break every containment filter that touches
    // the column.
    expect(coercePasted("multiSelect", "a, b")).toEqual(["a", "b"]);
  });

  it("parses the many spellings of true and false", () => {
    expect(coercePasted("boolean", "TRUE")).toBe(true);
    expect(coercePasted("boolean", "yes")).toBe(true);
    expect(coercePasted("boolean", "0")).toBe(false);
  });

  it("passes an invalid value through UNCHANGED for the server to reject", () => {
    // Silently dropping it would be worse: the paste would appear to work and
    // quietly lose data. Let the server 400 with a per-cell error.
    expect(coercePasted("boolean", "maybe")).toBe("maybe");
    expect(coercePasted("currency", "banana")).toBe("banana");
  });

  it("treats an empty cell as null, not an empty string", () => {
    expect(coercePasted("text", "   ")).toBeNull();
  });
});
