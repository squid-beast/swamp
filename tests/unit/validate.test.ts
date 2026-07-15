import { describe, expect, it } from "vitest";
import { validateValue } from "@/features/tables/validate";
import type { ValidatableField } from "@/features/tables/validate-types";

// Per-type value validation.
//
// This runs in three places: the grid, the record form, and the API write path.
// Only the third one matters for correctness — the UI is an affordance, not a
// boundary, and anything that can be typed can be POSTed. The API used to accept
// "banana" in a currency column without complaint.

const field = (f: Partial<ValidatableField> & Pick<ValidatableField, "type">) =>
  f as ValidatableField;

const ok = (f: ValidatableField, v: unknown) => validateValue(f, v).valid;

describe("emptiness", () => {
  it("always passes — required-ness is a form concern, not a type one", () => {
    // A blank currency cell is not an invalid currency. Conflating "empty" with
    // "wrong" makes it impossible to leave a field blank.
    for (const type of ["currency", "email", "date", "uuid"] as const) {
      expect(ok(field({ type }), "")).toBe(true);
      expect(ok(field({ type }), null)).toBe(true);
      expect(ok(field({ type }), "   ")).toBe(true);
    }
  });
});

describe("numbers", () => {
  const currency = field({ type: "currency" });

  it("accepts a plain number", () => {
    expect(ok(currency, "1200.50")).toBe(true);
  });

  it("accepts a formatted number", () => {
    expect(ok(currency, "$1,200.50")).toBe(true);
  });

  it("rejects text", () => {
    expect(ok(currency, "banana")).toBe(false);
  });

  it("allows a percent above 100 or below zero", () => {
    // Growth can exceed 100%; decline is negative. Clamping to 0–100 is a bug that
    // makes the field useless for the thing people mostly use it for.
    expect(ok(field({ type: "percent" }), "150")).toBe(true);
    expect(ok(field({ type: "percent" }), "-20")).toBe(true);
  });

  it("bounds a rating to 0–5", () => {
    expect(ok(field({ type: "rating" }), "5")).toBe(true);
    expect(ok(field({ type: "rating" }), "6")).toBe(false);
  });

  it("wants a four-digit year", () => {
    expect(ok(field({ type: "year" }), "2026")).toBe(true);
    expect(ok(field({ type: "year" }), "26")).toBe(false);
  });
});

describe("shapes", () => {
  it("validates an email", () => {
    expect(ok(field({ type: "email" }), "a@b.com")).toBe(true);
    expect(ok(field({ type: "email" }), "not-an-email")).toBe(false);
  });

  it("validates a URL, and allows a site-relative path", () => {
    expect(ok(field({ type: "url" }), "https://x.com")).toBe(true);
    expect(ok(field({ type: "url" }), "/local/path")).toBe(true);
    expect(ok(field({ type: "url" }), "nope")).toBe(false);
  });

  it("validates a UUID", () => {
    expect(ok(field({ type: "uuid" }), "550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(ok(field({ type: "uuid" }), "550e8400")).toBe(false);
  });

  it("validates a hex colour", () => {
    expect(ok(field({ type: "color" }), "#00AEEF")).toBe(true);
    expect(ok(field({ type: "color" }), "blue")).toBe(false);
  });

  it("validates coordinates", () => {
    expect(ok(field({ type: "coordinates" }), "51.5, -0.12")).toBe(true);
    expect(ok(field({ type: "coordinates" }), "somewhere")).toBe(false);
  });

  it("validates JSON", () => {
    expect(ok(field({ type: "json" }), '{"a":1}')).toBe(true);
    expect(ok(field({ type: "json" }), "{a:1}")).toBe(false);
  });

  it("accepts the many spellings of yes and no", () => {
    for (const v of ["true", "false", "yes", "no", "y", "n", "0", "1"]) {
      expect(ok(field({ type: "boolean" }), v), v).toBe(true);
    }
    expect(ok(field({ type: "boolean" }), "maybe")).toBe(false);
  });
});

describe("selects", () => {
  const options = [
    { value: "open", color: "teal" },
    { value: "closed", color: "rose" },
  ];

  it("rejects a value outside the option list", () => {
    const f = field({ type: "status", options });
    expect(ok(f, "open")).toBe(true);
    expect(ok(f, "banana")).toBe(false);
  });

  it("accepts anything when the field has no options yet", () => {
    // An option-less select is a select that hasn't been configured. Refusing every
    // value would make it impossible to fill in one you're mid-way through setting up.
    expect(ok(field({ type: "status" }), "anything")).toBe(true);
  });

  it("checks every value of a multi-select", () => {
    const f = field({ type: "multiSelect", options });
    expect(ok(f, "open, closed")).toBe(true);
    expect(ok(f, "open, banana")).toBe(false);
  });

  it("names the offending values", () => {
    const result = validateValue(field({ type: "multiSelect", options }), "banana, kiwi");
    expect(result.error).toContain("banana");
    expect(result.error).toContain("kiwi");
  });
});

describe("free-form types", () => {
  it("accepts anything in text, longText and duration", () => {
    for (const type of ["text", "longText", "duration"] as const) {
      expect(ok(field({ type }), "literally anything")).toBe(true);
    }
  });
});
