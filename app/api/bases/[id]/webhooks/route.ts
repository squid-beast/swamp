import { NextRequest, NextResponse } from "next/server";
import { createWebhook, listWebhooks } from "@/features/tables/webhooks";
import { createWebhookSchema } from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";
import type { FilterNode } from "@/features/tables/types";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  return NextResponse.json({ webhooks: await listWebhooks(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = createWebhookSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const webhook = await createWebhook(params.id, {
      ...parsed.data,
      condition: (parsed.data.condition as FilterNode | null) ?? null,
    });

    return NextResponse.json({ webhook }, { status: 201 });
  } catch (e) {
    // RLS: webhooks are creator-and-up. An editor gets here.
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
