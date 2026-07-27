import "server-only";
import { NextResponse } from "next/server";

// ════════════════════════════════════════════════════════════════════════════
// CORS for the PUBLIC ingress surface only.
//
// Two kinds of endpoint are meant to be called from another origin's browser:
//
//   • the token REST API   (/api/v1/*)          — auth is a Bearer header
//   • the public share API (/api/s/[shareId]/*) — auth is a share id / password
//
// Neither uses cookies, so `Access-Control-Allow-Origin: *` cannot be turned into
// a session-riding attack: there is no ambient credential for a cross-site
// request to borrow. That is why these — and ONLY these — get CORS. The
// authenticated app API (/api/tables, /api/bases, …) rides the Supabase session
// cookie and must never be openable cross-origin, so it gets nothing from here.
//
// If you want to lock the ingress to your own site, set SWAMP_CORS_ORIGINS to a
// comma-separated allow-list and the request Origin is echoed only when it
// matches. Unset means "*", which is correct for a public lead-gen API.
// ════════════════════════════════════════════════════════════════════════════

const HEADERS = "authorization, content-type, x-swamp-share-password, idempotency-key";
const METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

function allowList(): string[] | null {
  const raw = process.env.SWAMP_CORS_ORIGINS?.trim();
  if (!raw || raw === "*") return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** The Access-Control-* headers for a given request Origin. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const list = allowList();

  const allowOrigin =
    list === null ? "*" : origin && list.includes(origin) ? origin : list[0] ?? "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": METHODS,
    "Access-Control-Allow-Headers": HEADERS,
    "Access-Control-Max-Age": "86400",
  };

  // With a specific allow-list the answer varies per Origin, so caches must key
  // on it. With "*" it does not.
  if (list !== null) headers.Vary = "Origin";

  return headers;
}

/** Merge CORS headers into a response built by a handler. */
export function withCors<T extends Response>(res: T, origin: string | null): T {
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    res.headers.set(k, v);
  }
  return res;
}

/** The preflight answer. No body, just the permissions. */
export function preflight(origin: string | null): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
