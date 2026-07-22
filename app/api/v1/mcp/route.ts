import { NextRequest, NextResponse } from "next/server";
import { bearer } from "@/features/tables/rest";
import { preflight, withCors } from "@/features/tables/cors";
import { rateLimit, tooMany, V1_WRITE_LIMIT, WINDOW_SECONDS } from "@/features/tables/rate-limit";
import {
  handleMcp,
  JSON_RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "@/features/tables/mcp";

// ── /api/v1/mcp ──  Model Context Protocol, JSON-RPC 2.0 over HTTP.
//
// An AI agent points its MCP client here with `Authorization: Bearer <PAT>` and
// gets tools to read and write records. Authority is the token's, checked in the
// database on every tool call — this route holds no authorization logic, exactly
// like the rest of the v1 surface.
//
// We answer as application/json (never SSE): every method here is request →
// response, and we never push a server-initiated message, so there is no stream
// to open. A GET (which a client would use to open one) is therefore 405.

export const dynamic = "force-dynamic";

function jsonRpc(res: unknown, origin: string | null, status = 200) {
  return withCors(NextResponse.json(res, { status }), origin);
}

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export function GET(req: NextRequest) {
  return jsonRpc(
    { error: "This is an MCP endpoint. POST JSON-RPC 2.0 requests here." },
    req.headers.get("origin"),
    405
  );
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");

  const token = bearer(req);
  if (!token) {
    return jsonRpc(
      { error: "Missing token. Send: Authorization: Bearer <token>" },
      origin,
      401
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonRpc(
      { jsonrpc: "2.0", id: null, error: { code: JSON_RPC_ERRORS.PARSE_ERROR, message: "invalid JSON" } },
      origin
    );
  }

  // A single leaked key must not be able to drive unbounded writes through the
  // agent surface any more than through REST — same bucket family, same cap.
  if (!(await rateLimit(`v1:mcp:${token}`, V1_WRITE_LIMIT, WINDOW_SECONDS))) {
    return withCors(tooMany(WINDOW_SECONDS), origin);
  }

  // JSON-RPC allows a batch (an array). Handle both; drop the null replies that
  // notifications produce.
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return jsonRpc(
        { jsonrpc: "2.0", id: null, error: { code: JSON_RPC_ERRORS.INVALID_REQUEST, message: "empty batch" } },
        origin
      );
    }
    const out = (
      await Promise.all(body.map((r) => handleMcp(token, r as JsonRpcRequest)))
    ).filter((r): r is JsonRpcResponse => r !== null);

    // A batch of only notifications gets no body.
    return out.length ? jsonRpc(out, origin) : withCors(new NextResponse(null, { status: 202 }), origin);
  }

  const res = await handleMcp(token, body as JsonRpcRequest);
  return res ? jsonRpc(res, origin) : withCors(new NextResponse(null, { status: 202 }), origin);
}
