import { NextRequest, NextResponse } from "next/server";
import {
  apiDelete,
  apiError,
  apiInsert,
  apiPatch,
  apiQuery,
  bearer,
  InvalidValues,
} from "@/features/tables/rest";
import { BadQuery, parseRestQuery } from "@/features/tables/rest-query";
import { restCreateSchema, restPatchSchema } from "@/features/tables/schema";
import { preflight, withCors } from "@/features/tables/cors";
import { rateLimit, tooMany, V1_WRITE_LIMIT, WINDOW_SECONDS } from "@/features/tables/rate-limit";

// ── /api/v1/tables/:tableId/records ──
//
//   GET    ?limit&cursor&sort&search&filter&count   list
//   POST   { records: [{ fields }] }                create
//   PATCH  { records: [{ id, fields }] }            merge
//   DELETE ?ids=a,b,c                               soft delete
//
// Note what these handlers do NOT do: check anything. Authentication, scope, role
// and table ownership are all decided inside the database, by the SECURITY DEFINER
// function each call lands in. A guard written here is a guard that can be
// forgotten here — and the four other places that need the same one wouldn't have
// it either.

export const dynamic = "force-dynamic";

function unauthenticated(origin: string | null) {
  return withCors(
    NextResponse.json(
      { error: "Missing token. Send: Authorization: Bearer <token>" },
      { status: 401 }
    ),
    origin
  );
}

/** Writes are capped per token. A leaked lead-ingest key should not be able to
 *  hammer a table before anyone notices. Reads are not limited: they are the
 *  latency-sensitive, less abusable path. */
async function writeAllowed(token: string): Promise<boolean> {
  return rateLimit(`v1:write:${token}`, V1_WRITE_LIMIT, WINDOW_SECONDS);
}

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest, { params }: { params: { tableId: string } }) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) return unauthenticated(origin);

  try {
    const spec = parseRestQuery(req.nextUrl.searchParams);
    const wantCount = req.nextUrl.searchParams.get("count") === "1";

    return withCors(
      NextResponse.json(await apiQuery(token, params.tableId, spec, wantCount)),
      origin
    );
  } catch (e) {
    if (e instanceof BadQuery) {
      return withCors(NextResponse.json({ error: e.message }, { status: 400 }), origin);
    }
    return withCors(apiError(e), origin);
  }
}

export async function POST(req: NextRequest, { params }: { params: { tableId: string } }) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) return unauthenticated(origin);

  if (!(await writeAllowed(token))) return withCors(tooMany(WINDOW_SECONDS), origin);

  const parsed = restCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 }),
      origin
    );
  }

  try {
    const records = await apiInsert(token, params.tableId, parsed.data.records);
    return withCors(NextResponse.json({ records }, { status: 201 }), origin);
  } catch (e) {
    // A type error names the field it was about. "invalid values" on its own is
    // the worst possible answer to a 30-column POST.
    if (e instanceof InvalidValues) {
      return withCors(
        NextResponse.json({ error: "invalid values", errors: e.errors }, { status: 400 }),
        origin
      );
    }
    return withCors(apiError(e), origin);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { tableId: string } }) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) return unauthenticated(origin);

  if (!(await writeAllowed(token))) return withCors(tooMany(WINDOW_SECONDS), origin);

  const parsed = restPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 }),
      origin
    );
  }

  try {
    // A MERGE, not a replace. Sending one key changes one key — the others are
    // left alone, and two clients patching different cells of the same row both
    // survive, because the merge happens inside the UPDATE.
    const records = await apiPatch(token, params.tableId, parsed.data.records);
    return withCors(NextResponse.json({ records }), origin);
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

export async function DELETE(req: NextRequest, { params }: { params: { tableId: string } }) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) return unauthenticated(origin);

  if (!(await writeAllowed(token))) return withCors(tooMany(WINDOW_SECONDS), origin);

  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) {
    return withCors(NextResponse.json({ error: "pass ?ids=<id>,<id>" }, { status: 400 }), origin);
  }

  try {
    const deleted = await apiDelete(token, params.tableId, ids);
    return withCors(NextResponse.json({ deleted }), origin);
  } catch (e) {
    return withCors(apiError(e), origin);
  }
}
