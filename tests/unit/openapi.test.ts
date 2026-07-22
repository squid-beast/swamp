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
