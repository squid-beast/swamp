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

// ── /api/v1/tables/:tableId/records/:recordId ──
//
// The single-record verbs. Every integration reaches for these first, and an API
// that only does batches makes the simple thing hard.

export const dynamic = "force-dynamic";

type Params = { params: { tableId: string; recordId: string } };

function unauthenticated() {
  return NextResponse.json(
    { error: "Missing token. Send: Authorization: Bearer <token>" },
    { status: 401 }
  );
}

export async function GET(req: NextRequest, { params }: Params) {
  const token = bearer(req);
  if (!token) return unauthenticated();

  try {
    return NextResponse.json(await apiGet(token, params.tableId, params.recordId));
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const token = bearer(req);
  if (!token) return unauthenticated();

  const parsed = restRecordSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const [record] = await apiPatch(token, params.tableId, [
      { id: params.recordId, fields: parsed.data.fields },
    ]);

    // The patch touched nothing: the id isn't in this table, or it's deleted.
    if (!record) return NextResponse.json({ error: "no such record" }, { status: 404 });

    return NextResponse.json(record);
  } catch (e) {
    if (e instanceof InvalidValues) {
      return NextResponse.json({ error: "invalid values", errors: e.errors }, { status: 400 });
    }
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const token = bearer(req);
  if (!token) return unauthenticated();

  try {
    const deleted = await apiDelete(token, params.tableId, [params.recordId]);
    if (!deleted) return NextResponse.json({ error: "no such record" }, { status: 404 });

    return NextResponse.json({ id: params.recordId, deleted: true });
  } catch (e) {
    return apiError(e);
  }
}
