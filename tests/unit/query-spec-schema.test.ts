import { describe, expect, it } from "vitest";
import { querySpecSchema } from "@/features/tables/schema";

// The query spec is the wire format the client sends to the compiler.
//
// The compiler has its own boundary — it refuses unknown fields and unknown
// operators, and that's what actually stops injection. This schema exists so the
// same mistake comes back as a 400 saying which key was wrong, instead of a 500
// carrying a plpgsql exception. Defence in depth, and better errors.

describe("querySpecSchema", () => {
  it("accepts a nested filter tree", () => {
    const result = querySpecSchema.safeParse({
      filter: {
        op: "and",
        children: [
          { field: "fld_status", op: "eq", value: "open" },
          {
            op: "or",
            children: [
              { field: "fld_amount", op: "gt", value: 900 },
              { field: "fld_due", op: "isWithin", subOp: "nextNumberOfDays", n: 7 },
            ],
          },
        ],
      },
      sort: [{ field: "fld_amount", dir: "desc" }],
      limit: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown operator", () => {
    const result = querySpecSchema.safeParse({
      filter: { field: "fld_x", op: "haxx", value: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown date sub-operator", () => {
    const result = querySpecSchema.safeParse({
      filter: { field: "fld_due", op: "isWithin", subOp: "someday" },
    });
    expect(result.success).toBe(false);
  });

  it("caps filter nesting depth", () => {
    // A client-supplied tree is client-controlled input, and "nest it 10,000
    // deep" is otherwise a free stack overflow. The compiler caps this too; this
    // just turns a database exception into a 400.
    let node: unknown = { field: "fld_x", op: "eq", value: 1 };
    for (let i = 0; i < 15; i++) node = { op: "and", children: [node] };

    expect(querySpecSchema.safeParse({ filter: node }).success).toBe(false);
  });

  it("allows a tree right at the depth limit", () => {
    let node: unknown = { field: "fld_x", op: "eq", value: 1 };
    for (let i = 0; i < 10; i++) node = { op: "and", children: [node] };

    expect(querySpecSchema.safeParse({ filter: node }).success).toBe(true);
  });

  it("rejects a limit above the server cap", () => {
    expect(querySpecSchema.safeParse({ limit: 5000 }).success).toBe(false);
  });

  it("rejects unknown top-level keys rather than dropping them silently", () => {
    // .strict() — a typo'd key is a bug, not a no-op. `{ sorts: [...] }` should
    // fail loudly, not quietly return an unsorted page.
    expect(
      querySpecSchema.safeParse({ sorts: [{ field: "fld_x", dir: "asc" }] }).success
    ).toBe(false);
  });

  it("defaults a sort direction to asc", () => {
    const result = querySpecSchema.safeParse({ sort: [{ field: "fld_x" }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sort?.[0].dir).toBe("asc");
  });

  it("accepts an empty spec — that's just 'the whole table, first page'", () => {
    expect(querySpecSchema.safeParse({}).success).toBe(true);
  });
});
