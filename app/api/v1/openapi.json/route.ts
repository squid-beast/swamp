import { NextRequest, NextResponse } from "next/server";
import { buildOpenApi } from "@/features/tables/openapi";
import { preflight, withCors } from "@/features/tables/cors";

// GET /api/v1/openapi.json
//
// The machine-readable description of the REST API, so another project can
// generate a client instead of hand-writing one. Public and CORS-enabled: it is
// documentation, it names no data, and a tool fetching it runs in a browser.

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export function GET(req: NextRequest) {
  // The server URL is derived from the request so the spec works on localhost and
  // in production without a hard-coded host.
  const origin = req.headers.get("origin");
  const baseUrl = req.nextUrl.origin;

  return withCors(NextResponse.json(buildOpenApi(baseUrl)), origin);
}
