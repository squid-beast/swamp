import { describe, expect, it } from "vitest";
import {
  BadQuery,
  decodeCursor,
  encodeCursor,
  parseRestQuery,
} from "@/features/tables/rest-query";

// ════════════════════════════════════════════════════════════════════════════
// A query string is the least type-safe surface in the product. Everything
// arrives as a string — the numbers, the booleans, the nulls — and an API's first
// impression is whether `?limit=abc` says something useful or 500s.
// ════════════════════════════════════════════════════════════════════════════

const q = (s: string) => parseRestQuery(new URLSearchParams(s));

describe("the empty query", () => {
  it("is valid, and asks for nothing in particular", () => {
    expect(q("")).toEqual({});
  });
});

describe("sort", () => {
  it("defaults to ascending", () => {
    expect(q("sort=fld_name")).toEqual({ sort: [{ field: "fld_name", dir: "asc" }] });
  });

  it("takes a direction, and several fields", () => {
    expect(q("sort=fld_amount:desc,fld_name:asc")).toEqual({
      sort: [
        { field: "fld_amount", dir: "desc" },
        { field: "fld_name", dir: "asc" },
      ],
    });
  });

  it("refuses a direction that isn't one", () => {
    expect(() => q("sort=fld_name:sideways")).toThrow(BadQuery);
  });
});

describe("limit", () => {
  it("takes a number", () => {
    expect(q("limit=10")).toEqual({ limit: 10 });
  });

  it("refuses a non-number rather than coercing it to NaN", () => {
    // Number("abc") is NaN, and NaN sails through most guards. It would reach the
    // database as `limit NaN`, which is a 500 and a confused user.
    expect(() => q("limit=abc")).toThrow(BadQuery);
  });

  it("refuses a limit past the ceiling", () => {
    // The cap is in querySpecSchema — the SAME schema the app's own POST goes
    // through. There is one definition of a valid query and both doors use it.
    expect(() => q("limit=100000")).toThrow(BadQuery);
  });

  it("refuses zero and negatives", () => {
    expect(() => q("limit=0")).toThrow(BadQuery);
    expect(() => q("limit=-1")).toThrow(BadQuery);
  });
});

describe("filter", () => {
  it("takes a tree as JSON", () => {
    const filter = { field: "fld_status", op: "eq", value: "Won" };
    expect(q(`filter=${encodeURIComponent(JSON.stringify(filter))}`)).toEqual({ filter });
  });

  it("refuses an unknown operator", () => {
    // The database refuses it too — that's the real boundary. This just turns a
    // plpgsql exception into a 400 that says which word was wrong.
    const filter = { field: "fld_x", op: "sql-injection", value: 1 };
    expect(() => q(`filter=${encodeURIComponent(JSON.stringify(filter))}`)).toThrow(BadQuery);
  });

  it("refuses a tree nested past the cap", () => {
    // "nest it ten thousand deep" is otherwise a free stack overflow, from a query
    // string, with no authentication needed beyond a read token.
    let node: unknown = { field: "fld_x", op: "eq", value: 1 };
    for (let i = 0; i < 30; i++) node = { op: "and", children: [node] };

    expect(() => q(`filter=${encodeURIComponent(JSON.stringify(node))}`)).toThrow(BadQuery);
  });

  it("refuses JSON that isn't", () => {
    expect(() => q("filter={oh dear")).toThrow(BadQuery);
  });
});

describe("the cursor", () => {
  it("round-trips", () => {
    const cursor = { keys: ["a", 1], sortOrder: "12.5", id: "a3c1f7e2-0000-4000-8000-000000000000" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("survives a trip through the query string", () => {
    const cursor = { keys: [null], sortOrder: "1", id: "a3c1f7e2-0000-4000-8000-000000000000" };
    const parsed = q(`cursor=${encodeCursor(cursor)}`);
    expect(parsed.cursor).toEqual(cursor);
  });

  it("is base64 — not because it's secret, but because it must not look editable", () => {
    // If the cursor looked like structured data, someone would build a client that
    // constructs one, and the internal shape of the ordering tuple would become a
    // public contract we could never change.
    expect(encodeCursor({ id: 1 })).not.toContain("{");
  });

  it("rejects a cursor somebody made up", () => {
    expect(() => q("cursor=not-a-real-cursor!!")).toThrow(BadQuery);
  });
});
