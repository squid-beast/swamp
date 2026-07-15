import { NextRequest, NextResponse } from "next/server";
import { deleteWebhook, updateWebhook } from "@/features/tables/webhooks";
import { updateWebhookSchema } from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = updateWebhookSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ webhook: await updateWebhook(params.id, parsed.data) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  await deleteWebhook(params.id);
  return NextResponse.json({ ok: true });
}
