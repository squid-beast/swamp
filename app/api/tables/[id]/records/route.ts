import { NextRequest, NextResponse } from "next/server";
import {
  countRecords,
  deleteRecords,
  getTable,
  insertRecords,
  listFields,
  queryRecords,
  updateRecords,
} from "@/features/tables/repo";
import { signAttachments } from "@/features/tables/attachments";
import {
  createRecordsSchema,
  deleteRecordsSchema,
  querySpecSchema,
  updateRecordsSchema,
} from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";

// ── Records for one table. ──
//
// POST (not GET) for the read, because the query spec is a nested object — a
// filter tree does not survive a query string without being reinvented as one.
// This is a read; it is idempotent; it just needs a body.
//
// Note what is NOT here: an endpoint that returns every row. There is no way to
// ask this route for the whole table. The old `GET /api/datasets/[id]` returned
// the dataset AND all of its rows in one payload, capped at 5,000 with a silent
// truncation, and every caller loaded the lot into browser memory. That shape is
// the thing Phase 1 exists to delete.

export const dynamic = "force-dynamic";

/** Read one page. Filter, sort, search and pagination all execute in Postgres. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));

  // `?count=1` also returns the total. Split, because most callers want the rows
  // and only some want the count, and counting is the expensive half.
  const wantCount = req.nextUrl.searchParams.get("count") === "1";

  const parsed = querySpecSchema.safeParse(body?.spec ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid query", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const spec = parsed.data;
    const [page, total, fields] = await Promise.all([
      queryRecords(params.id, spec),
      wantCount ? countRecords(params.id, spec) : Promise.resolve(undefined),
      listFields(params.id),
    ]);

    // Attachment URLs are signed HERE, on the way out, and expire. They are never
    // stored: a persisted signed URL is a permanent public link to a private file,
    // and it outlives every permission change made afterwards.
    const records = await signAttachments(fields, page.records);
    const signed = { ...page, records };

    return NextResponse.json(wantCount ? { ...signed, total } : signed);
  } catch (e) {
    // The query compiler raises on an unknown field, an unknown operator, or a
    // table the caller cannot read. All of those are the client's fault.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Append records. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = createRecordsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const table = await getTable(params.id);
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { records, errors } = await insertRecords(
    params.id,
    table.baseId,
    parsed.data.records
  );
  if (errors.length) {
    return NextResponse.json({ error: "invalid values", errors }, { status: 400 });
  }

  return NextResponse.json({ records });
}

/** Merge values into existing records. Concurrent edits to different cells of the
 *  same row both survive — the merge happens inside the UPDATE, not in JS. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = updateRecordsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { errors, computed } = await updateRecords(params.id, parsed.data.patches);
  if (errors.length) {
    return NextResponse.json({ error: "invalid values", errors }, { status: 400 });
  }

  // `computed` is what the write changed that the client could not have known:
  // formulas, rollups, lookups, counts, modifiedTime/By, barcodes. Computed keys
  // only — never the scalars the caller just sent, which would race their typing.
  return NextResponse.json({ ok: true, computed });
}

/** Soft delete. The read path excludes these without the caller asking. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = deleteRecordsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  await deleteRecords(params.id, parsed.data.ids);
  return NextResponse.json({ ok: true });
}
