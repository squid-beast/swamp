import { describe, expect, it } from "vitest";
import { buildOpenApi, OPENAPI_PATHS } from "@/features/tables/openapi";

// The spec is hand-written, so the risk is that it drifts from the routes. These
// tests pin the shape and the paths; the integration side asserts the paths are
// real handlers.

describe("the OpenAPI document", () => {
  const doc = buildOpenApi("https://swampy.app");

  it("is OpenAPI 3.1 with a bearer security scheme", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  it("uses the request-derived server URL", () => {
    expect(doc.servers[0].url).toBe("https://swampy.app");
  });

  it("documents every path in OPENAPI_PATHS and nothing else", () => {
    expect(Object.keys(doc.paths).sort()).toEqual([...OPENAPI_PATHS].sort());
  });

  it("describes the lead-ingest create operation", () => {
    const create = doc.paths["/api/v1/tables/{tableId}/records"].post;
    expect(create.summary).toMatch(/create/i);
    expect(create.responses["201"]).toBeDefined();
    expect(create.responses["429"]).toBeDefined();
  });
});

describe("personalized spec (bearer)", () => {
  const meta = {
    base: { id: "b1", name: "CRM" },
    tables: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Leads",
        fields: [
          { id: "f1", name: "Name", key: "fld_name", type: "text", options: {}, isPrimary: true, readOnly: false },
          { id: "f2", name: "Amount", key: "fld_amount", type: "currency", options: {}, isPrimary: false, readOnly: false },
          { id: "f3", name: "Total", key: "fld_total", type: "rollup", options: {}, isPrimary: false, readOnly: true },
        ],
      },
    ],
  };

  it("adds one concrete path per table with a typed fields schema", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = buildOpenApi("https://x.test", meta as any) as any;
    const path = doc.paths["/api/v1/tables/11111111-1111-1111-1111-111111111111/records"];
    expect(path).toBeDefined();
    expect(path.get.summary).toContain("Leads");

    const schema =
      doc.components.schemas["Fields_11111111_1111_1111_1111_111111111111"];
    expect(schema.properties.fld_name.type).toBe("string");
    expect(schema.properties.fld_amount.type).toBe("number");
    expect(schema.properties.fld_total.readOnly).toBe(true);
  });

  it("the generic paths survive personalization", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = buildOpenApi("https://x.test", meta as any) as any;
    for (const p of OPENAPI_PATHS) expect(doc.paths[p]).toBeDefined();
  });

  it("without meta, no table-specific data appears", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = buildOpenApi("https://x.test") as any;
    expect(JSON.stringify(doc)).not.toContain("Leads");
  });
});
