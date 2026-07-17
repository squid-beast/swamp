import { NextRequest, NextResponse } from "next/server";
import { createBase } from "@/features/tables/repo";
import { createBaseSchema } from "@/features/tables/schema";
import { apiError } from "@/features/tables/rest";
import { requireAuth } from "@/shared/supabase/server";

// Create a base.
//
// `createBase` was reachable only through POST /api/templates — so the only way to
// get a base was to accept a starter template (CRM, content calendar, bug tracker)
// or the "blank" one. There was no /api/bases collection route at all.
//
// Authorization is RLS's ("bases: workspace creator inserts").

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = createBaseSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const base = await createBase(parsed.data.workspaceId, parsed.data.name);
    return NextResponse.json({ base }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
