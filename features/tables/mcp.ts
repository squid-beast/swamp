import "server-only";
import {
  apiDelete,
  apiAggregate,
  apiGet,
  apiInsert,
  apiMeta,
  apiPatch,
  apiQuery,
  InvalidValues,
} from "./rest";
import { decodeCursor } from "./rest-query";
import { querySpecSchema } from "./schema";
import type { Cursor, QuerySpec } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// A Model Context Protocol server for Swamp.
//
// MCP is how an AI agent — Claude, Cursor, a custom assistant — discovers and
// uses a tool. This exposes the lead store as one: "list the tables", "find the
// leads created this week", "add this lead". The agent connects to
// /api/v1/mcp with the SAME Personal Access Token the REST API uses, and every
// call lands in the SAME SECURITY DEFINER function — so an MCP agent can never do
// anything the token could not already do. There is no second authorization
// system here, by design.
//
// Transport is JSON-RPC 2.0 over HTTP (the "Streamable HTTP" shape, answered as a
// plain JSON response — we never push, so we never need SSE). This file is the
// pure protocol brain: given a token and one request object, it returns one
// response object (or null, for a notification, which gets no reply). The route
// is the thin HTTP wrapper.
// ════════════════════════════════════════════════════════════════════════════

/** Advertised protocol version. Echoed back to a client that asks for one it also
 *  supports; this is the one we implement against. */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// JSON-RPC error codes we use (the reserved ones from the spec).
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

// ─── The tools ──────────────────────────────────────────────────────────────

/** The catalogue an agent sees from `tools/list`. Names are verbs, descriptions
 *  say what the token needs, and every schema is closed so a model cannot invent
 *  a parameter that silently does nothing. */
export const MCP_TOOLS = [
  {
    name: "list_tables",
    description:
      "List every table in the base this token can reach, with each field's key, " +
      "name and type. Call this first: writes and filters are keyed by field KEY " +
      "(e.g. fld_email), which is stable, not by the display name, which can change.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "query_records",
    description:
      "Read records from a table. Supports a full-text `search`, a Swamp `filter` " +
      "tree, `sort`, `limit`, and a `cursor` for the next page. Needs records:read.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "The table id (from list_tables)." },
        search: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string", description: "The opaque cursor from a previous page." },
        count: { type: "boolean", description: "Also return the total row count." },
        sort: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: "A field key." },
              dir: { type: "string", enum: ["asc", "desc"] },
            },
            required: ["field"],
            additionalProperties: false,
          },
        },
        filter: {
          type: "object",
          description:
            "A Swamp filter tree: a leaf { field, op, value } or a group " +
            "{ op: 'and'|'or'|'not', children: [...] }.",
        },
      },
      required: ["tableId"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_table",
    description:
      "The schema of one table: every field's key, name, type and options. Use it " +
      "before writing so you send the right field KEYS and value shapes " +
      "(e.g. a singleSelect wants one of its option values). Needs records:read.",
    inputSchema: {
      type: "object",
      properties: { tableId: { type: "string" } },
      required: ["tableId"],
      additionalProperties: false,
    },
  },
  {
    name: "count_records",
    description:
      "Count the records in a table that match an optional `search` and `filter`, " +
      "without fetching them. Cheap way to answer 'how many leads this week'. Needs records:read.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        search: { type: "string" },
        filter: {
          type: "object",
          description: "A Swamp filter tree, same shape as query_records.",
        },
      },
      required: ["tableId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_record",
    description: "Fetch one record by id, with its computed fields. Needs records:read.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        recordId: { type: "string" },
      },
      required: ["tableId", "recordId"],
      additionalProperties: false,
    },
  },
  {
    name: "aggregate",
    description:
      "Column summaries over the records matching an optional `search` and `filter` — " +
      "sum, avg, min, max, median, std_dev, range, count variants, percent variants, " +
      "earliest/latest/date_range for dates. `aggregations` maps a field KEY (from " +
      "describe_table) to a summary name. Far cheaper than fetching rows to add them " +
      "up yourself. Needs records:read.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        search: { type: "string" },
        filter: {
          type: "object",
          description: "A Swamp filter tree, same shape as query_records.",
        },
        aggregations: {
          type: "object",
          description: 'e.g. { "fld_amount": "sum", "fld_name": "count_unique" }',
          additionalProperties: { type: "string" },
        },
      },
      required: ["tableId", "aggregations"],
      additionalProperties: false,
    },
  },
  {
    name: "create_records",
    description:
      "Create one or more records. Each is { fields: { <fieldKey>: value } }; " +
      "unknown or read-only keys are ignored. Needs records:write.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        records: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: { fields: { type: "object" } },
            required: ["fields"],
            additionalProperties: false,
          },
        },
      },
      required: ["tableId", "records"],
      additionalProperties: false,
    },
  },
  {
    name: "update_record",
    description:
      "Merge new values into one record — only the keys you send change. Needs records:write.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        recordId: { type: "string" },
        fields: { type: "object" },
      },
      required: ["tableId", "recordId", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_records",
    description: "Soft-delete records by id. Needs records:write.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        recordIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
      },
      required: ["tableId", "recordIds"],
      additionalProperties: false,
    },
  },
] as const;

type Args = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

/** Run one tool. Errors become an `isError` result rather than a protocol error —
 *  that is the MCP convention, and it lets the agent read what went wrong (a bad
 *  token, a missing scope, an invalid value) and correct itself. */
async function runTool(token: string, name: string, args: Args): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_tables":
        return ok(await apiMeta(token));

      case "query_records": {
        const tableId = str(args.tableId);
        if (!tableId) throw new McpBadParams("tableId is required");

        // Reuse the app's own spec schema so a filter tree an agent invents is
        // validated exactly like one the app sends.
        const parsed = querySpecSchema.safeParse({
          filter: args.filter,
          sort: args.sort,
          search: args.search,
          limit: args.limit,
        });
        if (!parsed.success) {
          throw new McpBadParams(parsed.error.issues.map((i) => i.message).join("; "));
        }

        const spec: QuerySpec = { ...parsed.data };
        const cursor = str(args.cursor);
        if (cursor) spec.cursor = decodeCursor(cursor) as Cursor;

        return ok(await apiQuery(token, tableId, spec, args.count === true));
      }

      case "describe_table": {
        const tableId = str(args.tableId);
        if (!tableId) throw new McpBadParams("tableId is required");
        // One table's schema, carved out of the base meta the token can already see —
        // no second door to secure, same as fieldsOf in rest.ts.
        const meta = await apiMeta(token);
        const table = meta.tables.find((t) => t.id === tableId);
        if (!table) throw new McpBadParams("no such table in this base");
        return ok(table);
      }

      case "count_records": {
        const tableId = str(args.tableId);
        if (!tableId) throw new McpBadParams("tableId is required");
        const parsed = querySpecSchema.safeParse({ filter: args.filter, search: args.search });
        if (!parsed.success) {
          throw new McpBadParams(parsed.error.issues.map((i) => i.message).join("; "));
        }
        // limit 1 keeps the page tiny; the count comes from the same filtered COUNT(*).
        const page = await apiQuery(token, tableId, { ...parsed.data, limit: 1 }, true);
        return ok({ total: page.total ?? 0 });
      }

      case "get_record": {
        const tableId = str(args.tableId);
        const recordId = str(args.recordId);
        if (!tableId || !recordId) throw new McpBadParams("tableId and recordId are required");
        return ok(await apiGet(token, tableId, recordId));
      }

      case "aggregate": {
        const tableId = str(args.tableId);
        if (!tableId) throw new McpBadParams("tableId is required");
        const aggs = args.aggregations;
        if (!aggs || typeof aggs !== "object" || Array.isArray(aggs)) {
          throw new McpBadParams("aggregations must be an object of { fieldKey: summaryName }");
        }
        const parsed = querySpecSchema.safeParse({ filter: args.filter, search: args.search });
        if (!parsed.success) {
          throw new McpBadParams(parsed.error.issues.map((i) => i.message).join("; "));
        }
        // The SQL side whitelists both the field keys (catalog) and the summary
        // names (fixed templates) — an unknown name raises before reaching SQL.
        return ok({
          values: await apiAggregate(
            token,
            tableId,
            parsed.data,
            aggs as Record<string, string>
          ),
        });
      }

      case "create_records": {
        const tableId = str(args.tableId);
        if (!tableId) throw new McpBadParams("tableId is required");
        const records = args.records;
        if (!Array.isArray(records) || records.length === 0) {
          throw new McpBadParams("records must be a non-empty array of { fields }");
        }
        const rows = records.map((r) => ({ fields: (r as Args)?.fields as Args }));
        return ok({ records: await apiInsert(token, tableId, rows) });
      }

      case "update_record": {
        const tableId = str(args.tableId);
        const recordId = str(args.recordId);
        if (!tableId || !recordId) throw new McpBadParams("tableId and recordId are required");
        const fields = (args.fields as Args) ?? {};
        const [record] = await apiPatch(token, tableId, [{ id: recordId, fields }]);
        return ok({ record: record ?? null });
      }

      case "delete_records": {
        const tableId = str(args.tableId);
        if (!tableId) throw new McpBadParams("tableId is required");
        const ids = Array.isArray(args.recordIds)
          ? (args.recordIds as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        if (!ids.length) throw new McpBadParams("recordIds must be a non-empty array");
        return ok({ deleted: await apiDelete(token, tableId, ids) });
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (e) {
    if (e instanceof InvalidValues) {
      return {
        content: [{ type: "text", text: `Invalid values: ${JSON.stringify(e.errors)}` }],
        isError: true,
      };
    }
    const message = (e as { message?: string })?.message ?? "tool failed";
    return { content: [{ type: "text", text: message.replace(/^swamp:\s*/, "") }], isError: true };
  }
}

class McpBadParams extends Error {}

// ─── The JSON-RPC brain ─────────────────────────────────────────────────────

const isNotification = (req: JsonRpcRequest) => req.id === undefined;

function reply(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function fail(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/**
 * Handle one JSON-RPC request. Returns the response, or null for a notification
 * (which by spec gets no reply). `token` is trusted only insofar as the database
 * trusts it: every tool call re-presents it to a SECURITY DEFINER function.
 */
export async function handleMcp(
  token: string,
  req: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  if (req?.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return fail(req?.id ?? null, INVALID_REQUEST, "not a valid JSON-RPC 2.0 request");
  }

  // Notifications (initialized, cancelled, …) are acknowledged by silence.
  if (req.method.startsWith("notifications/")) return null;

  switch (req.method) {
    case "initialize": {
      const wanted = str((req.params as Args)?.protocolVersion);
      return reply(req.id, {
        protocolVersion: wanted ?? MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "swamp", version: "1" },
        instructions:
          "Swamp is a database of records grouped into tables. Call list_tables " +
          "first to learn table ids and field keys, then query or create records.",
      });
    }

    case "ping":
      return reply(req.id, {});

    case "tools/list":
      return reply(req.id, { tools: MCP_TOOLS });

    case "tools/call": {
      if (isNotification(req)) return null;
      const params = (req.params as Args) ?? {};
      const name = str(params.name);
      if (!name) return fail(req.id, INVALID_PARAMS, "tools/call needs a tool name");
      const result = await runTool(token, name, (params.arguments as Args) ?? {});
      return reply(req.id, result);
    }

    default:
      if (isNotification(req)) return null;
      return fail(req.id, METHOD_NOT_FOUND, `unknown method: ${req.method}`);
  }
}

export const JSON_RPC_ERRORS = { PARSE_ERROR, INVALID_REQUEST } as const;
