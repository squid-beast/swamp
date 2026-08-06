import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/supabase/server";
import { requireAuth } from "@/shared/supabase/server";
import { deliverOne, type DeliveryTarget } from "@/features/tables/webhooks";
import { samplePayload } from "@/features/tables/webhook-sample";
import { rateLimit, tooMany } from "@/features/tables/rate-limit";
import type { WebhookKind } from "@/features/tables/types";

// POST /api/webhooks/[id]/test — send a synthetic delivery NOW and report what
// came back. Same code path as the cron dispatcher (deliverOne), which is the
// entire point: a test that goes through different code proves nothing.
//
// With a daily dispatcher, this button turns a 24-hour feedback loop into a
// 2-second one.
//
// Deliberately writes NO webhook_deliveries row — that table has no INSERT
// policy for anyone, by design, and a test is not an event.
//
// This is also a user-triggered outbound fetch with a synchronous response
// channel — an SSRF probe if left open. safeFetch refuses private targets, the
// response is a truncated body with NO headers, and it's rate-limited.

export const dynamic = "force-dynamic";

const TEST_LIMIT = 10; // per user per minute — a human clicking a button

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const db = createClient();

  // RLS: webhooks are creator-and-up; a viewer's select comes back empty.
  const { data: hook } = await db
    .from("webhooks")
    .select("id, base_id, table_id, url, secret, kind, template, config")
    .eq("id", params.id)
    .maybeSingle();

  if (!hook) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: userData } = await db.auth.getUser();
  if (!(await rateLimit(`whtest:${userData.user?.id}`, TEST_LIMIT, 60))) {
    return tooMany(30);
  }

  const target: DeliveryTarget = {
    url: (hook.url as string) ?? null,
    secret: hook.secret as string,
    kind: ((hook.kind as WebhookKind) ?? "generic"),
    template: (hook.template as string) ?? null,
    config: (hook.config as Record<string, unknown>) ?? {},
  };

  const payload = samplePayload(hook.base_id as string, (hook.table_id as string) ?? null);
  const out = await deliverOne(target, "test", `test-${crypto.randomUUID()}`, payload);

  return NextResponse.json({
    ok: out.ok,
    status: out.responseStatus ?? null,
    // A truncated body snippet only. Never headers.
    body: (out.responseBody ?? "").slice(0, 1000) || null,
    error: out.error ?? null,
  });
}
