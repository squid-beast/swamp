import { NextRequest, NextResponse } from "next/server";
import { apiError, apiInsert, apiMeta, bearer, InvalidValues } from "@/features/tables/rest";
import { recordsFrom, resolveIngestFields } from "@/features/tables/ingest";
import { preflight, withCors } from "@/features/tables/cors";
import { rateLimit, tooMany, V1_WRITE_LIMIT, WINDOW_SECONDS } from "@/features/tables/rate-limit";

// ── POST /api/ingest/:tableId ──
//
// The forgiving inbound endpoint for lead capture. Unlike /api/v1/…/records it
// accepts a bare flat JSON object and maps human field NAMES ("Email") as well as
// keys, so a Zapier/Make step or a website form can drop a lead straight in.
//
// Authority is unchanged: it needs a records:write Personal Access Token, checked
// inside the same SECURITY DEFINER function as the strict API. The token may arrive
// as `Authorization: Bearer …` (preferred, and the only safe option for anything
// that runs in a browser) or, for URL-only tools, as `?token=`.

export const dynamic = "force-dynamic";

function tokenFrom(req: NextRequest): string | null {
  return bearer(req) ?? req.nextUrl.searchParams.get("token");
}

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function POST(req: NextRequest, { params }: { params: { tableId: string } }) {
  const origin = req.headers.get("origin");
  const token = tokenFrom(req);

  if (!token) {
    return withCors(
      NextResponse.json(
        { error: "Missing token. Send Authorization: Bearer <token> (or ?token= for URL-only tools)." },
        { status: 401 }
      ),
      origin
    );
  }

  // Same per-token write cap as the strict API: a leaked ingest key can't hammer a
  // table before anyone notices.
  if (!(await rateLimit(`ingest:write:${token}`, V1_WRITE_LIMIT, WINDOW_SECONDS))) {
    return withCors(tooMany(WINDOW_SECONDS), origin);
  }

  const body = await req.json().catch(() => null);
  const incoming = recordsFrom(body);
  if (incoming.length === 0) {
    return withCors(
      NextResponse.json({ error: "Send a JSON object of fields, or { records: [...] }." }, { status: 400 }),
      origin
    );
  }
  if (incoming.length > 50) {
    return withCors(
      NextResponse.json({ error: "Too many records in one request (max 50)." }, { status: 400 }),
      origin
    );
  }

  try {
    // One meta read resolves the table's fields; the token must be allowed to see it,
    // so an unreadable table fails here with the same 404/401/403 the API uses.
    const meta = await apiMeta(token);
    const table = meta.tables.find((t) => t.id === params.tableId);
    if (!table) {
      return withCors(NextResponse.json({ error: "No such table." }, { status: 404 }), origin);
    }

    const resolved = incoming.map((r) => resolveIngestFields(table.fields, r));
    const unknownKeys = [...new Set(resolved.flatMap((r) => r.unknownKeys))];

    const records = await apiInsert(
      token,
      params.tableId,
      resolved.map((r) => ({ fields: r.fields }))
    );

    // The 201 reports which incoming keys matched nothing, so an integration author
    // can see a "Fisrt Name" typo without the record silently missing a column.
    return withCors(
      NextResponse.json(
        { records, ...(unknownKeys.length ? { ignoredKeys: unknownKeys } : {}) },
        { status: 201 }
      ),
      origin
    );
  } catch (e) {
    if (e instanceof InvalidValues) {
      return withCors(
        NextResponse.json({ error: "invalid values", errors: e.errors }, { status: 400 }),
        origin
      );
    }
    return withCors(apiError(e), origin);
  }
}
