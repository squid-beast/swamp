import { NextRequest, NextResponse } from "next/server";
import { getTable, listFields, listViews } from "@/features/tables/repo";
import { requireAuth } from "@/shared/supabase/server";

// The table's SHAPE — fields and views — with no records.
//
// This is the other half of the split. `GET /api/datasets/[id]` used to return
// the schema and every row together, so you could not load one without the
// other. Now the shape is small, cacheable and fetched once, while records are
// paged separately by whatever the view asks for.

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const table = await getTable(params.id);
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [fields, views] = await Promise.all([
    listFields(params.id),
    listViews(params.id),
  ]);

  return NextResponse.json({ table, fields, views });
}
