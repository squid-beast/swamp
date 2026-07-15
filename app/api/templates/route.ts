import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/shared/supabase/server";
import { createTemplateBase, isTemplateId } from "@/features/tables/templates";

// Create a base from a starter template (or a blank base). Session-gated; the
// RLS-scoped client does the inserts, so a non-creator simply fails.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const body = (await req.json()) as { template?: unknown };
    if (!isTemplateId(body.template)) {
      return NextResponse.json({ error: "unknown template" }, { status: 400 });
    }
    const result = await createTemplateBase(body.template);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
