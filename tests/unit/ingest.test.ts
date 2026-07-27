import { describe, it, expect } from "vitest";
import { recordsFrom, resolveIngestFields, resolveUpsertKey } from "@/features/tables/ingest";

// The ingest mapper is pure: shape-forgiveness and name→key resolution, with no
// database. Authority and value validity live in the SECURITY DEFINER path and are
// covered by the REST integration tests.

const FIELDS = [
  { key: "fld_name", name: "Full Name", readOnly: false },
  { key: "fld_email", name: "Email", readOnly: false },
  { key: "fld_created", name: "Created Time", readOnly: true },
];

describe("recordsFrom", () => {
  it("unwraps the strict { records: [{ fields }] } envelope", () => {
    expect(recordsFrom({ records: [{ fields: { a: 1 } }, { fields: { b: 2 } }] })).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  it("accepts an array of flat objects under records", () => {
    expect(recordsFrom({ records: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it("accepts a single { fields } object", () => {
    expect(recordsFrom({ fields: { a: 1 } })).toEqual([{ a: 1 }]);
  });

  it("accepts a bare flat object — the webform case", () => {
    expect(recordsFrom({ Email: "a@b.com", "Full Name": "Ada" })).toEqual([
      { Email: "a@b.com", "Full Name": "Ada" },
    ]);
  });

  it("returns nothing for non-objects", () => {
    expect(recordsFrom(null)).toEqual([]);
    expect(recordsFrom("nope")).toEqual([]);
    expect(recordsFrom(42)).toEqual([]);
  });
});

describe("resolveIngestFields", () => {
  it("maps by field key", () => {
    const { fields } = resolveIngestFields(FIELDS, { fld_email: "a@b.com" });
    expect(fields).toEqual({ fld_email: "a@b.com" });
  });

  it("maps by display name, case- and space-insensitively", () => {
    const { fields } = resolveIngestFields(FIELDS, { "  full name ": "Ada", EMAIL: "a@b.com" });
    expect(fields).toEqual({ fld_name: "Ada", fld_email: "a@b.com" });
  });

  it("drops read-only fields even when named exactly", () => {
    const { fields } = resolveIngestFields(FIELDS, { "Created Time": "2026-01-01", Email: "a@b.com" });
    expect(fields).toEqual({ fld_email: "a@b.com" });
  });

  it("reports unknown keys instead of failing", () => {
    const { fields, unknownKeys } = resolveIngestFields(FIELDS, {
      Email: "a@b.com",
      Fisrt: "typo",
    });
    expect(fields).toEqual({ fld_email: "a@b.com" });
    expect(unknownKeys).toEqual(["Fisrt"]);
  });

  it("prefers the key match over the name match", () => {
    const { fields } = resolveIngestFields(FIELDS, { fld_name: "byKey" });
    expect(fields).toEqual({ fld_name: "byKey" });
  });
});

describe("resolveUpsertKey", () => {
  it("resolves a display name to its field key, case- and space-insensitively", () => {
    expect(resolveUpsertKey(FIELDS, "Email")).toBe("fld_email");
    expect(resolveUpsertKey(FIELDS, "  email ")).toBe("fld_email");
    expect(resolveUpsertKey(FIELDS, "FULL NAME")).toBe("fld_name");
  });

  it("resolves a field key directly, case-insensitively", () => {
    expect(resolveUpsertKey(FIELDS, "fld_email")).toBe("fld_email");
    expect(resolveUpsertKey(FIELDS, "FLD_EMAIL")).toBe("fld_email");
  });

  it("returns null for a field that does not exist", () => {
    expect(resolveUpsertKey(FIELDS, "Phone")).toBeNull();
    expect(resolveUpsertKey(FIELDS, "fld_nope")).toBeNull();
  });

  it("returns null for a read-only / computed field — upserting on it is never meant", () => {
    // "Created Time" is readOnly: a formula or stamp can't be an upsert key, and the
    // SQL would refuse it anyway. Null tells the route to answer 400.
    expect(resolveUpsertKey(FIELDS, "Created Time")).toBeNull();
    expect(resolveUpsertKey(FIELDS, "fld_created")).toBeNull();
  });
});
