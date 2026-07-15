import { describe, expect, it } from "vitest";
import { deriveFieldKey } from "@/features/tables/field-key";
import {
  isComputedField,
  isReadOnlyField,
  operatorsFor,
  roleAtLeast,
} from "@/features/tables/types";

describe("deriveFieldKey", () => {
  it("slugifies a display name", () => {
    expect(deriveFieldKey("Contract Value", new Set())).toBe("fld_contract_value");
  });

  it("disambiguates a collision rather than overwriting", () => {
    // Two columns called "Name" is not a mistake — it happens in real CSVs. The
    // second must get its own key, or its values land on top of the first's.
    const taken = new Set(["fld_name"]);
    expect(deriveFieldKey("Name", taken)).toBe("fld_name_2");
  });

  it("survives a name with nothing sluggable in it", () => {
    expect(deriveFieldKey("!!!", new Set())).toBe("fld_field");
  });

  it("is derived from the name ONCE and then frozen", () => {
    // The key lives in record.data and must never change: a rename has to be
    // free, and formulas reference fields by id, not name. So a field created as
    // "Amt" keeps the key `fld_amt` even after it's renamed to "Contract value".
    // That looks odd in the database and is exactly right.
    const key = deriveFieldKey("Amt", new Set());
    expect(key).toBe("fld_amt");
    // Nothing in the API takes a key and a new name — there is no rename-the-key
    // path, by design.
  });
});

describe("field type predicates", () => {
  it("marks computed fields read-only", () => {
    for (const t of ["formula", "rollup", "lookup", "count", "link"] as const) {
      expect(isReadOnlyField(t), t).toBe(true);
      expect(isComputedField(t), t).toBe(true);
    }
  });

  it("marks auto-maintained fields read-only but not computed", () => {
    // createdBy has a real value on the row — it just isn't one a user may write.
    expect(isReadOnlyField("createdBy")).toBe(true);
    expect(isComputedField("createdBy")).toBe(false);
  });

  it("leaves ordinary scalars writable", () => {
    expect(isReadOnlyField("currency")).toBe(false);
    expect(isReadOnlyField("multiSelect")).toBe(false);
  });
});

describe("operatorsFor", () => {
  it("gates operators by field type", () => {
    // Offering `>` on a checkbox, or `checked` on a text field, is how a filter
    // builder ends up feeling like a debug tool.
    expect(operatorsFor("boolean")).toEqual(["checked", "notchecked"]);
    expect(operatorsFor("currency")).toContain("gt");
    expect(operatorsFor("currency")).not.toContain("checked");
    expect(operatorsFor("text")).not.toContain("gt");
    expect(operatorsFor("multiSelect")).toContain("allof");
    expect(operatorsFor("date")).toContain("isWithin");
  });
});

describe("roleAtLeast", () => {
  it("encodes the ladder", () => {
    expect(roleAtLeast("owner", "creator")).toBe(true);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast(null, "viewer")).toBe(false);
  });

  it("puts the schema boundary between editor and creator", () => {
    // The load-bearing line in the whole permission model: editors change DATA
    // and VIEWS, creators change SCHEMA.
    expect(roleAtLeast("editor", "creator")).toBe(false);
    expect(roleAtLeast("creator", "creator")).toBe(true);
  });
});
