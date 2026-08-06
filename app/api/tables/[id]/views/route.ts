import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTable, listViews } from "@/features/tables/repo";
import { VIEW_TYPES } from "@/features/tables/types";
import { createView } from "@/features/tables/schema-ops";
import { requireAuth } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

const createViewSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(VIEW_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json({ views: await listViews(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = createViewSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const table = await getTable(params.id);
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const view = await createView(params.id, table.baseId, parsed.data);
    return NextResponse.json({ view });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
