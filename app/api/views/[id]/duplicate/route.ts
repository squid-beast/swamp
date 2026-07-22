import { NextRequest, NextResponse } from "next/server";
import { duplicateView } from "@/features/tables/schema-ops";
import { requireAuth } from "@/shared/supabase/server";

// POST /api/views/[id]/duplicate
//
// A real view duplicate: the view row AND its filters, sorts and field settings,
// which live in their own tables. Server-side because it's several inserts that must
// all land together — the client copy could only ever see the view row.

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const view = await duplicateView(params.id);
    return NextResponse.json({ view }, { status: 201 });
  } catch (e) {
    // View creation is editor-gated; RLS turns a viewer's attempt into an error here.
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
