import { NextResponse } from "next/server";
import { createClient, requireAuth } from "@/shared/supabase/server";
import { buildDeliveryBody } from "@/features/tables/webhook-format";
import { samplePayload } from "@/features/tables/webhook-sample";
import type { WebhookKind } from "@/features/tables/types";

// GET /api/webhooks/[id]/sample — the exact body this webhook would send, built
// from a synthetic payload. No network, no DB write; pure preview.

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { data: hook } = await createClient()
    .from("webhooks")
    .select("id, base_id, table_id, kind, template")
    .eq("id", params.id)
    .maybeSingle();

  if (!hook) return NextResponse.json({ error: "not found" }, { status: 404 });

  const kind = ((hook.kind as WebhookKind) ?? "generic");
  const payload = samplePayload(hook.base_id as string, (hook.table_id as string) ?? null);
  const body = buildDeliveryBody(kind, (hook.template as string) ?? null, payload);

  return NextResponse.json({ kind, body });
}
