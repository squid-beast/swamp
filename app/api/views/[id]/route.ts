import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteView, updateView } from "@/features/tables/schema-ops";
import { requireAuth } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    config: z.record(z.string(), z.unknown()),
    lockType: z.enum(["collaborative", "locked", "personal"]),
  })
  .partial()
  .strict();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await updateView(params.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await deleteView(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // "The default view cannot be deleted" lands here. It's a 400, not a 500 —
    // the user asked for something the model doesn't allow, which is their
    // mistake and should read like one.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
