import { describe, expect, it } from "vitest";
import { inferFields } from "@/features/tables/engine/inference";

// ════════════════════════════════════════════════════════════════════════════
// Type inference.
//
// The best code in the repo, and — until now — completely untested. It survived
// the whole rewrite untouched because it's genuinely good, which is exactly why it
// deserved a net under it before someone "tidies" it.
//
// The behaviours below are not incidental. Every one of them is a data-loss bug
// somebody hit once and fixed here.
// ════════════════════════════════════════════════════════════════════════════

const infer = (col: string, values: unknown[]) =>
  inferFields([col], values.map((v) => ({ [col]: v })))[0];

const typeOf = (col: string, values: unknown[]) => infer(col, values).type;

describe("leading zeros must survive", () => {
  it("keeps a zip code as text, not a number", () => {
    // "02134" → 2134 is silent, irreversible data loss. It is the single most
    // common inference bug there is.
    expect(typeOf("zip", ["02134", "01234", "90210"])).toBe("text");
  });

  it("keeps anything with an id-ish header as text", () => {
    expect(typeOf("order_id", ["001", "002"])).toBe("text");
    expect(typeOf("sku", ["0012", "0034"])).toBe("text");
    expect(typeOf("invoice_no", ["0001"])).toBe("text");
  });

  it("keeps a numeric column as text when many values have leading zeros", () => {
    expect(typeOf("code", ["007", "042", "013", "099"])).toBe("text");
  });
});

describe("strong value shapes beat loose header keywords", () => {
  it("reads an email regardless of what the column is called", () => {
    expect(typeOf("contact", ["a@b.com", "c@d.org"])).toBe("email");
  });

  it("reads a URL", () => {
    expect(typeOf("link", ["https://example.com", "https://x.dev"])).toBe("url");
  });

  it("reads an image URL as an image, not a plain URL", () => {
    expect(typeOf("photo", ["https://x.com/a.png", "https://x.com/b.jpg"])).toBe("image");
  });

  it("reads a UUID", () => {
    expect(
      typeOf("ref", [
        "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        "550e8400-e29b-41d4-a716-446655440000",
      ])
    ).toBe("uuid");
  });

  it("reads a hex colour", () => {
    expect(typeOf("brand", ["#00AEEF", "#FF0000"])).toBe("color");
  });

  it("promotes a money-shaped value even under a name that looks like an id", () => {
    // "invoice_amount" contains "invoice" — an always-text keyword. But the VALUES
    // carry a currency symbol, and a real value beats a loose header match.
    const field = infer("invoice_amount", ["$1,200.00", "$450.00"]);
    expect(field.type).toBe("currency");
  });
});

describe("numeric types need corroborating evidence", () => {
  it("does not call bare numbers a currency just because the header says amount", () => {
    // A header alone isn't enough. Without money-shaped values this is a number.
    expect(typeOf("amount", ["1", "2", "3"])).toBe("number");
  });

  it("reads a percent when the values carry a percent sign", () => {
    expect(typeOf("growth", ["12%", "8%", "-3%"])).toBe("percent");
  });

  it("reads a rating only when the values fit and the header agrees", () => {
    expect(typeOf("rating", ["4", "5", "3"])).toBe("rating");
    // Same values, a header that means something else: just a number.
    expect(typeOf("children", ["4", "5", "3"])).toBe("number");
  });

  it("reads a year", () => {
    expect(typeOf("year", ["2024", "1999", "2026"])).toBe("year");
  });
});

describe("dates", () => {
  it("reads an ISO date", () => {
    expect(typeOf("due", ["2026-07-14", "2026-08-01"])).toBe("date");
  });

  it("reads an ISO datetime", () => {
    expect(typeOf("at", ["2026-07-14T09:00:00Z", "2026-07-15T10:30:00Z"])).toBe("datetime");
  });
});

describe("selects", () => {
  it("reads a low-cardinality column as a single select", () => {
    const field = infer("category", [
      "red", "green", "blue", "red", "green", "blue", "red", "green",
    ]);
    expect(field.type).toBe("singleSelect");
    expect(field.options?.map((o) => o.value).sort()).toEqual(["blue", "green", "red"]);
  });

  it("reads a status-shaped column as a status", () => {
    const field = infer("status", [
      "open", "closed", "open", "closed", "open", "closed", "open",
    ]);
    expect(field.type).toBe("status");
  });

  it("assigns each option a colour", () => {
    const field = infer("stage", ["new", "won", "lost", "new", "won", "lost", "new"]);
    expect(field.options!.every((o) => !!o.color)).toBe(true);
  });

  it("reads a comma-heavy column as a multi select", () => {
    expect(
      typeOf("tags", ["a, b", "b, c", "a, c", "a, b, c", "b", "c, a"])
    ).toBe("multiSelect");
  });

  it("does NOT call a high-cardinality column a select", () => {
    // 100 distinct values is a name column, not an enum. Turning it into a select
    // would give you a hundred-option dropdown nobody can use.
    const values = Array.from({ length: 100 }, (_, i) => `person ${i}`);
    expect(typeOf("name", values)).toBe("text");
  });
});

describe("fallbacks", () => {
  it("reads long prose as long text", () => {
    const long = "x".repeat(120);
    expect(typeOf("notes", [long, long, long])).toBe("longText");
  });

  it("reads JSON", () => {
    expect(typeOf("payload", ['{"a":1}', '{"b":2}'])).toBe("json");
  });

  it("hides a JSON column by default", () => {
    // Raw JSON blobs are noise in a grid. The field still exists — it's just not
    // in your face on import.
    expect(infer("payload", ['{"a":1}', '{"b":2}']).hidden).toBe(true);
  });

  it("falls back to text when nothing matches", () => {
    expect(typeOf("misc", ["asdf", "qwer", "zxcv"])).toBe("text");
  });
});

describe("the field it produces", () => {
  it("humanises the column name", () => {
    expect(infer("first_name", ["a"]).name).toBe("First Name");
    expect(infer("firstName", ["a"]).name).toBe("First Name");
  });

  it("keeps the original header, so a sheet sync can still find the column", () => {
    expect(infer("first_name", ["a"]).sourceName).toBe("first_name");
  });

  it("does NOT mint an id", () => {
    // It used to, from a MODULE-LEVEL COUNTER — so a field's identity depended on
    // how many files the process had already parsed, and the same CSV produced
    // different ids after a restart. Inference now proposes; the database row is
    // the truth and owns the identity.
    expect(infer("x", ["a"])).not.toHaveProperty("id");
  });

  it("proposes only what a Field needs, and nothing it doesn't", () => {
    // The old FieldMeta carried `sortable`, `filterable`, `groupable`, `searchable`,
    // `unique` and `confidence` — six properties that were written on every import
    // and read by absolutely nothing. Dead surface reads as capability that doesn't
    // exist.
    const field = infer("amount", ["$1.00"]);
    expect(Object.keys(field).sort()).toEqual(
      ["currency", "hidden", "name", "options", "sourceName", "type"].sort()
    );
  });
});
