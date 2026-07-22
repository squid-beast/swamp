import { describe, it, expect, vi, beforeEach } from "vitest";

// The MCP module is the protocol brain over the REST layer. Mock the REST layer
// so these tests pin the JSON-RPC dispatch, tool routing and error shaping —
// without a database. The authority path (token → SECURITY DEFINER function) is
// the REST layer's own integration tests' job.

// vi.mock is hoisted above the file, so the mock functions have to be created in
// a hoisted block too — otherwise the factory closes over uninitialised consts.
const { apiMeta, apiQuery, apiGet, apiInsert, apiPatch, apiDelete, InvalidValues } =
  vi.hoisted(() => {
    class InvalidValues extends Error {
      constructor(public errors: unknown) {
        super("invalid values");
      }
    }
    return {
      apiMeta: vi.fn(),
      apiQuery: vi.fn(),
      apiGet: vi.fn(),
      apiInsert: vi.fn(),
      apiPatch: vi.fn(),
      apiDelete: vi.fn(),
      InvalidValues,
    };
  });

vi.mock("@/features/tables/rest", () => ({
  apiMeta,
  apiQuery,
  apiGet,
  apiInsert,
  apiPatch,
  apiDelete,
  InvalidValues,
}));

import {
  handleMcp,
  MCP_TOOLS,
  MCP_PROTOCOL_VERSION,
} from "@/features/tables/mcp";

const TOKEN = "swamp_pat_test";
const call = (method: string, params?: unknown, id: unknown = 1) =>
  handleMcp(TOKEN, { jsonrpc: "2.0", id, method, params } as never);

/** The text of a tools/call result's first content block, parsed if it's JSON. */
const resultData = (res: unknown) => {
  const text = (res as { result: { content: { text: string }[] } }).result.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const isError = (res: unknown) =>
  (res as { result: { isError?: boolean } }).result.isError === true;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handshake", () => {
  it("initialize returns serverInfo and capabilities", async () => {
    const res = await call("initialize", {});
    expect(res).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "swamp" },
        capabilities: { tools: {} },
      },
    });
  });

  it("initialize echoes a protocol version the client asks for", async () => {
    const res = await call("initialize", { protocolVersion: "2025-06-18" });
    expect((res as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2025-06-18"
    );
  });

  it("ping answers empty", async () => {
    expect(await call("ping")).toMatchObject({ result: {} });
  });

  it("a notification gets no reply", async () => {
    expect(await handleMcp(TOKEN, { jsonrpc: "2.0", method: "notifications/initialized" } as never)).toBeNull();
  });

  it("an unknown method is a JSON-RPC method-not-found error", async () => {
    const res = await call("frobnicate");
    expect((res as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("rejects a non-2.0 request", async () => {
    const res = await handleMcp(TOKEN, { jsonrpc: "1.0", id: 1, method: "ping" } as never);
    expect((res as { error: { code: number } }).error.code).toBe(-32600);
  });
});

describe("tools/list", () => {
  it("lists all eight tools with closed input schemas", async () => {
    const res = await call("tools/list");
    const tools = (res as { result: { tools: typeof MCP_TOOLS } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual([
      "list_tables",
      "query_records",
      "describe_table",
      "count_records",
      "get_record",
      "create_records",
      "update_record",
      "delete_records",
    ]);
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });
});

describe("tools/call routing", () => {
  it("list_tables calls apiMeta with the token", async () => {
    apiMeta.mockResolvedValue({ base: { id: "b" }, tables: [] });
    const res = await call("tools/call", { name: "list_tables", arguments: {} });
    expect(apiMeta).toHaveBeenCalledWith(TOKEN);
    expect(resultData(res)).toEqual({ base: { id: "b" }, tables: [] });
  });

  it("query_records forwards a validated spec", async () => {
    apiQuery.mockResolvedValue({ records: [] });
    await call("tools/call", {
      name: "query_records",
      arguments: {
        tableId: "t1",
        search: "acme",
        limit: 5,
        sort: [{ field: "fld_name", dir: "desc" }],
        filter: { field: "fld_name", op: "eq", value: "Acme" },
        count: true,
      },
    });
    expect(apiQuery).toHaveBeenCalledWith(
      TOKEN,
      "t1",
      expect.objectContaining({
        search: "acme",
        limit: 5,
        sort: [{ field: "fld_name", dir: "desc" }],
        filter: { field: "fld_name", op: "eq", value: "Acme" },
      }),
      true // wantCount
    );
  });

  it("query_records decodes an opaque cursor into the spec", async () => {
    apiQuery.mockResolvedValue({ records: [] });
    const cursor = Buffer.from(JSON.stringify({ keys: [1], sortOrder: "1", id: "x" })).toString(
      "base64url"
    );
    await call("tools/call", { name: "query_records", arguments: { tableId: "t1", cursor } });
    const spec = apiQuery.mock.calls[0][2] as { cursor: unknown };
    expect(spec.cursor).toEqual({ keys: [1], sortOrder: "1", id: "x" });
  });

  it("query_records without tableId is a tool error, not a crash", async () => {
    const res = await call("tools/call", { name: "query_records", arguments: {} });
    expect(isError(res)).toBe(true);
    expect(apiQuery).not.toHaveBeenCalled();
  });

  it("create_records maps to apiInsert with { fields } rows", async () => {
    apiInsert.mockResolvedValue([{ id: "r1", fields: { fld_name: "Acme" } }]);
    const res = await call("tools/call", {
      name: "create_records",
      arguments: { tableId: "t1", records: [{ fields: { fld_name: "Acme" } }] },
    });
    expect(apiInsert).toHaveBeenCalledWith(TOKEN, "t1", [{ fields: { fld_name: "Acme" } }]);
    expect(resultData(res)).toEqual({ records: [{ id: "r1", fields: { fld_name: "Acme" } }] });
  });

  it("update_record maps to a single-row apiPatch", async () => {
    apiPatch.mockResolvedValue([{ id: "r1", fields: { fld_name: "New" } }]);
    await call("tools/call", {
      name: "update_record",
      arguments: { tableId: "t1", recordId: "r1", fields: { fld_name: "New" } },
    });
    expect(apiPatch).toHaveBeenCalledWith(TOKEN, "t1", [{ id: "r1", fields: { fld_name: "New" } }]);
  });

  it("delete_records maps to apiDelete", async () => {
    apiDelete.mockResolvedValue(2);
    const res = await call("tools/call", {
      name: "delete_records",
      arguments: { tableId: "t1", recordIds: ["a", "b"] },
    });
    expect(apiDelete).toHaveBeenCalledWith(TOKEN, "t1", ["a", "b"]);
    expect(resultData(res)).toEqual({ deleted: 2 });
  });

  it("describe_table returns the one table's schema from apiMeta", async () => {
    apiMeta.mockResolvedValue({
      base: { id: "b" },
      tables: [
        { id: "t1", name: "Leads", fields: [{ key: "fld_name", type: "text" }] },
        { id: "t2", name: "Deals", fields: [] },
      ],
    });
    const res = await call("tools/call", {
      name: "describe_table",
      arguments: { tableId: "t1" },
    });
    expect(resultData(res)).toEqual({
      id: "t1",
      name: "Leads",
      fields: [{ key: "fld_name", type: "text" }],
    });
  });

  it("describe_table for an unknown table is a tool error", async () => {
    apiMeta.mockResolvedValue({ base: { id: "b" }, tables: [] });
    const res = await call("tools/call", {
      name: "describe_table",
      arguments: { tableId: "nope" },
    });
    expect(isError(res)).toBe(true);
  });

  it("count_records returns only the total, from a counted query", async () => {
    apiQuery.mockResolvedValue({ records: [], total: 42 });
    const res = await call("tools/call", {
      name: "count_records",
      arguments: { tableId: "t1", search: "acme" },
    });
    expect(apiQuery).toHaveBeenCalledWith(
      TOKEN,
      "t1",
      expect.objectContaining({ search: "acme", limit: 1 }),
      true
    );
    expect(resultData(res)).toEqual({ total: 42 });
  });

  it("an unknown tool is a tool error", async () => {
    const res = await call("tools/call", { name: "drop_database", arguments: {} });
    expect(isError(res)).toBe(true);
  });
});

describe("error shaping", () => {
  it("surfaces a DB auth failure as a readable tool error, stripped of the swamp prefix", async () => {
    apiMeta.mockRejectedValue(Object.assign(new Error("swamp: invalid API token"), { code: "28000" }));
    const res = await call("tools/call", { name: "list_tables", arguments: {} });
    expect(isError(res)).toBe(true);
    expect(resultData(res)).toBe("invalid API token");
  });

  it("surfaces invalid values with the per-field detail", async () => {
    apiInsert.mockRejectedValue(new InvalidValues([{ field: "fld_amount", message: "not a number" }]));
    const res = await call("tools/call", {
      name: "create_records",
      arguments: { tableId: "t1", records: [{ fields: { fld_amount: "banana" } }] },
    });
    expect(isError(res)).toBe(true);
    expect(resultData(res)).toContain("fld_amount");
  });
});
