import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTable } from "@/features/tables/repo";
import { setLinks } from "@/features/tables/relations";
import { requireAuth } from "@/shared/supabase/server";

// Set the records a link cell points at.
//
// Replaces, rather than appends: the client sends the full set it wants, which is
// what the picker actually knows. An add/remove API would need the client to track
// deltas, and the first thing it would get wrong is a double-click.

export const dynamic = "force-dynamic";

const schema = z.object({
  fieldId: z.string().uuid(),
  recordId: z.string().uuid(),
  linkedIds: z.array(z.string().uuid()).max(500),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const table = await getTable(params.id);
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await setLinks(
      parsed.data.fieldId,
      table.baseId,
      parsed.data.recordId,
      parsed.data.linkedIds
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
