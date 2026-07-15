import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";
import { shareView, unshareView } from "@/features/tables/sharing";

// Share or revoke a view.
//
// The password is hashed IN POSTGRES (bcrypt, via pgcrypto). It is never stored,
// logged, or returned — once set, the only thing the owner can do is replace it.
// That's deliberate: a "show password" affordance means the plaintext has to live
// somewhere, and it doesn't.

export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().max(200).optional(),
  allowDownload: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const shareId = await shareView(params.id, parsed.data.password);

    if (parsed.data.allowDownload !== undefined) {
      await createClient()
        .from("views")
        .update({ share_options: { allowDownload: parsed.data.allowDownload } })
        .eq("id", params.id);
    }

    return NextResponse.json({ shareId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await unshareView(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
