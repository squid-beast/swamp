import { NextRequest, NextResponse } from "next/server";
import {
  apiDelete,
  apiError,
  apiGet,
  apiPatch,
  bearer,
  InvalidValues,
} from "@/features/tables/rest";
import { restRecordSchema } from "@/features/tables/schema";
import { preflight, withCors } from "@/features/tables/cors";
import { rateLimit, tooMany, V1_WRITE_LIMIT, WINDOW_SECONDS } from "@/features/tables/rate-limit";

// ── /api/v1/tables/:tableId/records/:recordId ──
//
// The single-record verbs. Every integration reaches for these first, and an API
// that only does batches makes the simple thing hard.

export const dynamic = "force-dynamic";

type Params = { params: { tableId: string; recordId: string } };

function unauthenticated(origin: string | null) {
  return withCors(
    NextResponse.json(
      { error: "Missing token. Send: Authorization: Bearer <token>" },
      { status: 401 }
    ),
    origin
  );
}

async function writeAllowed(token: string): Promise<boolean> {
  return rateLimit(`v1:write:${token}`, V1_WRITE_LIMIT, WINDOW_SECONDS);
}

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest, { params }: Params) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) return unauthenticated(origin);

  try {
    return withCors(NextResponse.json(await apiGet(token, params.tableId, params.recordId)), origin);
  } catch (e) {
    return withCors(apiError(e), origin);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) return unauthenticated(origin);

  if (!(await writeAllowed(token))) return withCors(tooMany(WINDOW_SECONDS), origin);

  const parsed = restRecordSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 }),
      origin
    );
  }

  try {
    const [record] = await apiPatch(token, params.tableId, [
      { id: params.recordId, fields: parsed.data.fields },
    ]);

    // The patch touched nothing: the id isn't in this table, or it's deleted.
    if (!record) {
      return withCors(NextResponse.json({ error: "no such record" }, { status: 404 }), origin);
    }

    return withCors(NextResponse.json(record), origin);
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

export async function DELETE(req: NextRequest, { params }: Params) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) return unauthenticated(origin);

  if (!(await writeAllowed(token))) return withCors(tooMany(WINDOW_SECONDS), origin);

  try {
    const deleted = await apiDelete(token, params.tableId, [params.recordId]);
    if (!deleted) {
      return withCors(NextResponse.json({ error: "no such record" }, { status: 404 }), origin);
    }

    return withCors(NextResponse.json({ id: params.recordId, deleted: true }), origin);
  } catch (e) {
    return withCors(apiError(e), origin);
  }
}
