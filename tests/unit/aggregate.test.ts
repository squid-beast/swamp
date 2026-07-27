import { describe, it, expect } from "vitest";
import {
  aggregationsFor,
  COMMON_AGGREGATIONS,
  NUMERIC_AGGREGATIONS,
  BOOLEAN_AGGREGATIONS,
  DATE_AGGREGATIONS,
} from "@/features/tables/types";

// aggregationsFor is the gate the column-footer UI uses to decide which summaries a
// field may offer, and it is mirrored line-for-line by the whitelist in
// swamp_aggregate (20260721010000_aggregate.sql). If the two ever drift, a summary
// the UI offers would raise in SQL — so this pins the TS side, and the integration
// test pins the SQL side against the same shape.

describe("aggregationsFor", () => {
  it("offers only the common set for a plain text field", () => {
    expect(aggregationsFor("text")).toEqual(COMMON_AGGREGATIONS);
  });

  it("adds the numeric summaries for numeric field types", () => {
    for (const type of ["number", "currency", "percent", "rating", "year", "duration", "autoNumber"] as const) {
      expect(aggregationsFor(type)).toEqual([...COMMON_AGGREGATIONS, ...NUMERIC_AGGREGATIONS]);
    }
  });

  it("adds the date summaries for temporal field types", () => {
    for (const type of ["date", "datetime"] as const) {
      expect(aggregationsFor(type)).toEqual([...COMMON_AGGREGATIONS, ...DATE_AGGREGATIONS]);
    }
  });

  it("adds the boolean summaries for a checkbox", () => {
    expect(aggregationsFor("boolean")).toEqual([...COMMON_AGGREGATIONS, ...BOOLEAN_AGGREGATIONS]);
  });

  it("does not offer numeric summaries where they'd be meaningless", () => {
    // sum on a name, or avg on a status, is the kind of thing a footer should never
    // present — the common set is the whole menu for a non-numeric, non-temporal type.
    expect(aggregationsFor("text")).not.toContain("sum");
    expect(aggregationsFor("singleSelect")).not.toContain("avg");
    expect(aggregationsFor("email")).toEqual(COMMON_AGGREGATIONS);
  });
});
