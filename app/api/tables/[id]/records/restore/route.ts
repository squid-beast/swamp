import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";

// Un-delete records.
//
// This exists because of UNDO, and it's only possible because deletion is SOFT.
// The rows were never removed — just tombstoned — so restoring them is an update,
// and every id in the undo stack still points at the row it always did.
//
// A hard delete would make undo mean "re-insert the captured records", which
// hands them NEW ids and breaks every command below it on the stack that
// referenced the old ones. Soft delete isn't a nicety here; it's what makes the
// undo stack coherent.

export const dynamic = "force-dynamic";

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { error } = await createClient()
    .from("records")
    .update({ deleted_at: null })
    .eq("table_id", params.id)
    .in("id", parsed.data.ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
