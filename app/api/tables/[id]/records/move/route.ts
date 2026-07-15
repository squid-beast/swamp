import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { moveRecord } from "@/features/tables/repo";
import { createClient, requireAuth } from "@/shared/supabase/server";

// Move a row.
//
// Two shapes, because they have different callers:
//
//   { recordId, beforeId, afterId }  — a DRAG. The client says which two rows it
//     landed between; the SERVER computes the midpoint. Clients don't get to
//     invent sort_order values, or two people dragging at once pick the same
//     number and the list stops having a deterministic order.
//
//   { recordId, sortOrder }          — an UNDO. The exact previous order, which
//     the command captured before it moved anything. There's no midpoint to
//     compute: we're restoring a value we already know.

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({
    recordId: z.string().uuid(),
    beforeId: z.string().uuid().nullish(),
    afterId: z.string().uuid().nullish(),
  }),
  z.object({
    recordId: z.string().uuid(),
    sortOrder: z.number(),
  }),
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const body = parsed.data;

  try {
    if ("sortOrder" in body) {
      const { error } = await createClient()
        .from("records")
        .update({ sort_order: body.sortOrder })
        .eq("id", body.recordId)
        .eq("table_id", params.id);
      if (error) throw new Error(error.message);

      return NextResponse.json({ sortOrder: body.sortOrder });
    }

    const sortOrder = await moveRecord(
      params.id,
      body.recordId,
      body.beforeId ?? null,
      body.afterId ?? null
    );
    return NextResponse.json({ sortOrder });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
