import { NextRequest, NextResponse } from "next/server";
import { createClient, requireAuth } from "@/shared/supabase/server";

// GET /api/tables/[id]/trash
//
// The deleted records for a table, most-recently-deleted first. Deletion is SOFT
// everywhere in Swamp (a `deleted_at` stamp, never a row removal), and the records
// SELECT policy is a plain `swamp_can(base_id, 'viewer')` with no deleted filter —
// so a base member can read their own tombstones directly, and the Trash panel is
// just a query, not a new privileged function.
//
// Restoring is the existing POST /records/restore, which flips `deleted_at` back
// to null. Together they make delete reversible without a hard-delete anywhere.

export const dynamic = "force-dynamic";

const LIMIT = 200;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { data, error } = await createClient()
    .from("records")
    .select("id, data, deleted_at")
    .eq("table_id", params.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(LIMIT);

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({
    records: (data ?? []).map((r) => ({
      id: r.id as string,
      data: (r.data as Record<string, unknown>) ?? {},
      deletedAt: r.deleted_at as string,
    })),
  });
}
