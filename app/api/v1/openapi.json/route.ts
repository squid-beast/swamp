import { NextRequest, NextResponse } from "next/server";
import { buildOpenApi } from "@/features/tables/openapi";
import { apiError, apiMeta, bearer } from "@/features/tables/rest";
import { preflight, withCors } from "@/features/tables/cors";

// GET /api/v1/openapi.json
//
// Two specs from one route:
//
//   · No Authorization header → the GENERIC spec. Public and CORS-enabled: it
//     is documentation, it names no data.
//   · Bearer token → the PERSONALIZED spec: one concrete path per table, with a
//     typed `fields` schema per field key. It names the caller's tables and
//     keys, so it is `Cache-Control: no-store` and NOT CORS-wildcarded — it
//     carries only what the token could read anyway, but a cache or another
//     origin must not see it by accident.
//   · A PRESENT but dead token → 401, not a silent fall-back to the generic
//     spec. A typo that quietly degrades the answer is a debugging session.

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  // The server URL is derived from the request so the spec works on localhost and
  // in production without a hard-coded host.
  const origin = req.headers.get("origin");
  const baseUrl = req.nextUrl.origin;

  const token = bearer(req);
  if (!token) {
    return withCors(NextResponse.json(buildOpenApi(baseUrl)), origin);
  }

  try {
    const meta = await apiMeta(token);
    return NextResponse.json(buildOpenApi(baseUrl, meta), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
