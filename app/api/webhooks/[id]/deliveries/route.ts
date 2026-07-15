import { NextRequest, NextResponse } from "next/server";
import { listDeliveries } from "@/features/tables/webhooks";
import { requireAuth } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

/** The call log: what we sent, what came back, how many times we tried. Nobody has
 *  ever debugged a webhook without one. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  return NextResponse.json({ deliveries: await listDeliveries(params.id) });
}
