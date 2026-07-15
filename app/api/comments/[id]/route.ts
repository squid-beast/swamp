import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteComment,
  resolveComment,
  updateComment,
} from "@/features/tables/collaboration";
import { getUserId, requireAuth } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    body: z.string().trim().min(1).max(10000),
    resolved: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const userId = await getUserId();

  try {
    // Editing is gated by RLS to your OWN comment. Resolving is not — anyone who
    // can comment can mark a thread settled, which is what people expect.
    if (parsed.data.body !== undefined) await updateComment(params.id, parsed.data.body);
    if (parsed.data.resolved !== undefined) {
      await resolveComment(params.id, parsed.data.resolved, userId!);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await deleteComment(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
