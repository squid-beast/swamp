import { NextRequest, NextResponse } from "next/server";
import { revokeInvite } from "@/features/tables/collaboration";
import { requireAuth } from "@/shared/supabase/server";

// Revoke a pending invite. Gated at CREATOR by RLS on `base_invites`.
//
// Deleting the row kills the token. There is no "expired" state to reason about —
// the invite either exists or it doesn't.

export const dynamic = "force-dynamic";

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await revokeInvite(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
