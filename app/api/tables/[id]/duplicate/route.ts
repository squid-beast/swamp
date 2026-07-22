import { NextRequest, NextResponse } from "next/server";
import { createClient, requireAuth } from "@/shared/supabase/server";

// POST /api/tables/[id]/duplicate
//
// Copies the table — fields, a default view, and (by default) every record — in one
// atomic function. All the authorization lives in the database: swamp_duplicate_table
// runs as the caller under RLS, and creating a table + fields is creator-gated, so an
// editor's call fails there rather than here.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  // `withRecords` defaults to true — the common intent is a full clone. Send
  // { withRecords: false } for the empty-shell case (same schema, no rows).
  const body = (await req.json().catch(() => ({}))) as { withRecords?: boolean };

  const { data, error } = await createClient().rpc("swamp_duplicate_table", {
    p_table_id: params.id,
    p_with_records: body.withRecords !== false,
  });

  if (error) {
    // A creator-gated insert refuses an editor with 42501 → 403; anything else the
    // database rejected is the user's request being wrong, so 400.
    const status = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: error.message.replace(/^swamp:\s*/, "") }, { status });
  }

  return NextResponse.json({ tableId: data as string }, { status: 201 });
}
