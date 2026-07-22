import { describe, expect, it } from "vitest";
import { formatAutoNumber } from "@/features/tables/types";

// The stored value is always the bare integer; formatAutoNumber is the ONLY place
// prefix/padding are applied, so the grid, the expanded record and the form all
// agree by calling it. These pin the display rules.

describe("formatAutoNumber", () => {
  it("returns the bare number with no options", () => {
    expect(formatAutoNumber(7)).toBe("7");
    expect(formatAutoNumber(1043)).toBe("1043");
  });

  it("applies a prefix", () => {
    expect(formatAutoNumber(7, { prefix: "LEAD-" })).toBe("LEAD-7");
  });

  it("zero-pads to the minimum width, and does not truncate a longer number", () => {
    expect(formatAutoNumber(7, { padding: 4 })).toBe("0007");
    expect(formatAutoNumber(1043, { padding: 4 })).toBe("1043");
    expect(formatAutoNumber(12345, { padding: 4 })).toBe("12345");
  });

  it("combines prefix and padding", () => {
    expect(formatAutoNumber(7, { prefix: "LEAD-", padding: 4 })).toBe("LEAD-0007");
  });

  it("renders empty for a missing value", () => {
    expect(formatAutoNumber(null)).toBe("");
    expect(formatAutoNumber(undefined)).toBe("");
    expect(formatAutoNumber("")).toBe("");
  });

  it("pads the digits and keeps the sign outside them", () => {
    expect(formatAutoNumber(-7, { padding: 3 })).toBe("-007");
  });

  it("passes through a non-numeric value rather than throwing", () => {
    expect(formatAutoNumber("N/A")).toBe("N/A");
  });

  it("accepts a numeric string, as the query engine may hand it back", () => {
    expect(formatAutoNumber("42", { padding: 4 })).toBe("0042");
  });
});
