import { describe, it, expect } from "vitest";
import { recordsFrom, resolveIngestFields } from "@/features/tables/ingest";

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
