import { NextRequest, NextResponse } from "next/server";
import { aggregateRecords } from "@/features/tables/repo";
import { aggregateRequestSchema } from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";

// ── Column footer summaries for one table. ──
//
// POST for the same reason the records read is a POST: the query spec is a nested
// object a query string can't carry. Session-authed like the sibling records
// route — swamp_aggregate is deliberately off the anon surface.
//
// Body: { spec, aggregations }, where `aggregations` maps a field key to one
// summary name. Response: { values }, a map of field key -> computed value over
// the SAME filtered set the rows are read with.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = aggregateRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const { spec, aggregations } = parsed.data;
    const values = await aggregateRecords(params.id, spec, aggregations);
    return NextResponse.json({ values });
  } catch (e) {
    // swamp_aggregate raises on an unknown field, an aggregation not valid for the
    // field's type, or a table the caller cannot read — all the client's fault.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
