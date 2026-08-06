import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";

// Share / unshare a whole base. SECURITY INVOKER underneath — RLS decides who
// may share, exactly as it decides who may edit the base.
//
// The public landing (/s/b/[shareId]) lists only views that are THEMSELVES
// already shared; a base share never exposes records or fields on its own.

export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(1).max(200).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { data, error } = await createClient().rpc("swamp_share_base", {
    p_base_id: params.id,
    p_password: parsed.data.password ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ shareId: data as string });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { error } = await createClient().rpc("swamp_unshare_base", {
    p_base_id: params.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
