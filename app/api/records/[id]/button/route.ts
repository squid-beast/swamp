import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fireButton } from "@/features/tables/webhooks";
import { requireAuth } from "@/shared/supabase/server";

// POST /api/records/:id/button  { fieldId }
//
// Runs a `button` field whose action is a webhook.
//
// The call is made SERVER-SIDE, out of the delivery queue. The browser never learns
// the target URL and never holds the secret — a button that fetched its own URL
// from the client would put both in the page source, where the person you didn't
// want pressing it can read them and press it themselves, forever.

export const dynamic = "force-dynamic";

const bodySchema = z.object({ fieldId: z.string().uuid() }).strict();

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    // swamp_fire_button checks the role (editor+). A viewer looking at a grid does
    // not get to press a button that charges a credit card.
    const deliveryId = await fireButton(params.id, parsed.data.fieldId);
    return NextResponse.json({ deliveryId, queued: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
