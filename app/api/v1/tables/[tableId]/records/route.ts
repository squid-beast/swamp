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

function unauthenticated() {
  return NextResponse.json(
    { error: "Missing token. Send: Authorization: Bearer <token>" },
    { status: 401 }
  );
}

export async function GET(req: NextRequest, { params }: { params: { tableId: string } }) {
  const token = bearer(req);
  if (!token) return unauthenticated();

  try {
    const spec = parseRestQuery(req.nextUrl.searchParams);
    const wantCount = req.nextUrl.searchParams.get("count") === "1";

    return NextResponse.json(await apiQuery(token, params.tableId, spec, wantCount));
  } catch (e) {
    if (e instanceof BadQuery) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: { tableId: string } }) {
  const token = bearer(req);
  if (!token) return unauthenticated();

  const parsed = restCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const records = await apiInsert(token, params.tableId, parsed.data.records);
    return NextResponse.json({ records }, { status: 201 });
  } catch (e) {
    // A type error names the field it was about. "invalid values" on its own is
    // the worst possible answer to a 30-column POST.
    if (e instanceof InvalidValues) {
      return NextResponse.json({ error: "invalid values", errors: e.errors }, { status: 400 });
    }
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { tableId: string } }) {
  const token = bearer(req);
  if (!token) return unauthenticated();

  const parsed = restPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    // A MERGE, not a replace. Sending one key changes one key — the others are
    // left alone, and two clients patching different cells of the same row both
    // survive, because the merge happens inside the UPDATE.
    const records = await apiPatch(token, params.tableId, parsed.data.records);
    return NextResponse.json({ records });
  } catch (e) {
    if (e instanceof InvalidValues) {
      return NextResponse.json({ error: "invalid values", errors: e.errors }, { status: 400 });
    }
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { tableId: string } }) {
  const token = bearer(req);
  if (!token) return unauthenticated();

  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) {
    return NextResponse.json({ error: "pass ?ids=<id>,<id>" }, { status: 400 });
  }

  try {
    const deleted = await apiDelete(token, params.tableId, ids);
    return NextResponse.json({ deleted });
  } catch (e) {
    return apiError(e);
  }
}
