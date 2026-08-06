// ════════════════════════════════════════════════════════════════════════════
// The OpenAPI description of the public REST API (/api/v1).
//
// Hand-written rather than generated, because there are eight operations and a
// generator would be a dependency and a build step to describe them. It is kept
// beside the routes it documents, and the integration test asserts every path in
// it resolves to a real handler — so it cannot drift silently.
//
// Values are keyed by field KEY, never by name. That is the one thing an
// integration author has to internalise, so it is said in the description of
// every operation that touches a record.
// ════════════════════════════════════════════════════════════════════════════

const RECORDS = "/api/v1/tables/{tableId}/records";
const ONE = "/api/v1/tables/{tableId}/records/{recordId}";

const tableIdParam = {
  name: "tableId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: "From GET /api/v1/meta.",
};

const recordIdParam = {
  name: "recordId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const recordSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    fields: {
      type: "object",
      additionalProperties: true,
      description: "Keyed by field key (e.g. fld_name), never by field name.",
    },
    createdTime: { type: "string", format: "date-time" },
  },
};

// ── Per-table personalization ──────────────────────────────────────────────
//
// With a token's ApiMeta in hand, the generic spec grows one concrete path per
// table, whose `fields` schema names every key with its JSON type. The result
// names the caller's tables and keys, so the PERSONALIZED spec is no-store and
// never CORS-wildcarded — see the route.

import type { ApiMeta, ApiField } from "./rest";

/** A field's value, as JSON. Coarse on purpose: an integration author needs
 *  "string vs number vs array", not our 38-type taxonomy. */
function fieldJsonSchema(f: ApiField): Record<string, unknown> {
  const numeric = ["number", "currency", "percent", "rating", "year", "duration", "autoNumber"];
  const arrays = ["multiSelect", "lookup", "link", "attachment"];

  const schema: Record<string, unknown> = numeric.includes(f.type)
    ? { type: "number" }
    : f.type === "boolean"
      ? { type: "boolean" }
      : arrays.includes(f.type)
        ? { type: "array" }
        : f.type === "json"
          ? {}
          : { type: "string" };

  schema.title = f.name;
  schema.description = `${f.name} (${f.type})${f.readOnly ? " — read-only, computed by the server" : ""}`;
  if (f.readOnly) schema.readOnly = true;
  return schema;
}

/** Concrete per-table paths + schemas, merged over the generic spec. */
function personalize(spec: Record<string, unknown>, meta: ApiMeta): void {
  const components = spec.components as { schemas: Record<string, unknown> };
  const paths = spec.paths as Record<string, unknown>;

  for (const table of meta.tables) {
    const schemaName = `Fields_${table.id.replace(/-/g, "_")}`;
    components.schemas[schemaName] = {
      type: "object",
      title: `${table.name} fields`,
      description: `The fields of “${table.name}”, keyed by field key.`,
      properties: Object.fromEntries(table.fields.map((f) => [f.key, fieldJsonSchema(f)])),
      additionalProperties: false,
    };

    // A concrete path SHADOWS the templated one in every OpenAPI consumer, so it
    // has to carry the full operation — parameters and error responses included.
    // "See the generic path" is not something a generated client can follow.
    const listParams = [
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
      { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque; from the previous page." },
      { name: "sort", in: "query", schema: { type: "string" }, description: "e.g. fld_amount:desc,fld_name" },
      { name: "search", in: "query", schema: { type: "string" } },
      { name: "filter", in: "query", schema: { type: "string" }, description: "A JSON filter tree." },
      { name: "count", in: "query", schema: { type: "string", enum: ["1"] }, description: "Include a total." },
    ];

    const authErrors = {
      "401": { description: "Missing or dead token." },
      "403": { description: "Token lacks the scope, or the owner's role is too low." },
      "429": { description: "Rate limit exceeded." },
    };

    paths[`/api/v1/tables/${table.id}/records`] = {
      get: {
        tags: [table.name],
        summary: `List ${table.name} records`,
        description: `Concrete instance of the generic records path, for “${table.name}”.`,
        parameters: listParams,
        responses: {
          ...authErrors,
          "200": {
            description: "A page of records.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    records: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          fields: { $ref: `#/components/schemas/${schemaName}` },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: [table.name],
        summary: `Create ${table.name} records`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: {
                  records: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["fields"],
                      properties: { fields: { $ref: `#/components/schemas/${schemaName}` } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          ...authErrors,
          "201": { description: "The created records, with any computed fields." },
          "400": { description: "Invalid values." },
        },
      },
    };
  }
}

export function buildOpenApi(baseUrl: string, meta?: ApiMeta) {
  // The generic spec's inferred shape is the public contract (the unit test
  // reads it); personalization mutates around the `as const` via a local cast.
  const spec = buildGenericOpenApi(baseUrl);
  if (meta) {
    const mutable = spec as unknown as Record<string, unknown>;
    (mutable.info as Record<string, unknown>).description =
      `Personalized for the base “${meta.base.name}”. Table paths below are concrete; ` +
      `the generic /api/v1/tables/{tableId}/records path still applies to all of them.`;
    personalize(mutable, meta);
  }
  return spec;
}

function buildGenericOpenApi(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "SWAMP REST API",
      version: "1.0.0",
      description:
        "Read and write records with a scoped API token.\n\n" +
        "Authenticate with `Authorization: Bearer <token>`. Mint a token from a " +
        "base's API page; scope it to `records:read` / `records:write` and, if you " +
        "like, pin it to specific tables.\n\n" +
        "Every `fields` object is keyed by field **key** (like `fld_name`), which " +
        "never changes when a column is renamed. Look the keys up once from " +
        "`GET /api/v1/meta`.",
    },
    servers: [{ url: baseUrl }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "swamp_pat" },
      },
      schemas: {
        Record: recordSchema,
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
    paths: {
      "/api/v1/meta": {
        get: {
          summary: "Base schema",
          description:
            "The base, its tables, and the key of every field. The first call any " +
            "integration makes. A pinned token sees only the tables it may reach.",
          responses: {
            "200": { description: "The base and its tables." },
            "401": {
              description: "Missing or dead token.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
            },
          },
        },
      },
      [RECORDS]: {
        parameters: [tableIdParam],
        get: {
          summary: "List records",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
            { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque; from the previous page." },
            { name: "sort", in: "query", schema: { type: "string" }, description: "e.g. fld_amount:desc,fld_name" },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "filter", in: "query", schema: { type: "string" }, description: "A JSON filter tree." },
            { name: "count", in: "query", schema: { type: "string", enum: ["1"] }, description: "Include a total." },
          ],
          responses: {
            "200": { description: "A page of records, plus an optional cursor." },
            "401": { description: "Missing or dead token." },
          },
        },
        post: {
          summary: "Create records",
          description: "Up to 1000 at a time. This is the lead-ingest verb.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["records"],
                  properties: {
                    records: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["fields"],
                        properties: { fields: { type: "object", additionalProperties: true } },
                      },
                    },
                  },
                },
                example: { records: [{ fields: { fld_name: "Jane", fld_email: "jane@co.com" } }] },
              },
            },
          },
          responses: {
            "201": { description: "The created records, with any computed fields." },
            "400": { description: "Invalid values." },
            "401": { description: "Missing or dead token." },
            "403": { description: "Token lacks records:write, or owner's role is too low." },
            "429": { description: "Rate limit exceeded." },
          },
        },
        patch: {
          summary: "Update records (merge)",
          description: "Sends one key, changes one key. The rest of the record is left alone.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["records"],
                  properties: {
                    records: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "fields"],
                        properties: {
                          id: { type: "string", format: "uuid" },
                          fields: { type: "object", additionalProperties: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "The updated records." }, "429": { description: "Rate limit exceeded." } },
        },
        delete: {
          summary: "Delete records",
          parameters: [
            { name: "ids", in: "query", required: true, schema: { type: "string" }, description: "Comma-separated ids." },
          ],
          responses: { "200": { description: "How many were deleted." }, "429": { description: "Rate limit exceeded." } },
        },
      },
      [ONE]: {
        parameters: [tableIdParam, recordIdParam],
        get: {
          summary: "Get one record",
          responses: { "200": { description: "The record." }, "404": { description: "No such record." } },
        },
        patch: {
          summary: "Update one record (merge)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["fields"],
                  properties: { fields: { type: "object", additionalProperties: true } },
                },
              },
            },
          },
          responses: { "200": { description: "The updated record." }, "404": { description: "No such record." } },
        },
        delete: {
          summary: "Delete one record",
          responses: { "200": { description: "Deleted." }, "404": { description: "No such record." } },
        },
      },
    },
  } as const;
}

/** Every path the spec documents, for the test that asserts none of them 404. */
export const OPENAPI_PATHS = [RECORDS, ONE, "/api/v1/meta"] as const;
