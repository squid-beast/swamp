import { NextRequest, NextResponse } from "next/server";
import { revokeToken } from "@/features/tables/api-tokens";
import { requireAuth } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

/** Revoke. Not delete — the row survives, so "what was that thing and when did it
 *  last run" still has an answer after an incident. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  await revokeToken(params.id);
  return NextResponse.json({ ok: true });
}
