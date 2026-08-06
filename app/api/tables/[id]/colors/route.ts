import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";
import { filterNodeSchema } from "@/features/tables/schema";

// POST /api/tables/[id]/colors — evaluate the view's row-colour rules over a
// page of record ids. SECURITY INVOKER underneath (swamp_row_colors), so RLS
// decides what the caller can colour, exactly as it decides what they can read.
//
// Session-only. The shared path deliberately has no colour rules — a rule over
// a hidden field is a blind-oracle read of that field.

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  recordIds: z.array(z.string().uuid()).min(1).max(500),
  rules: z
    .array(z.object({ filter: filterNodeSchema, color: z.string().min(1).max(30) }))
    .min(1)
    .max(5),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data, error } = await createClient().rpc("swamp_row_colors", {
    p_table_id: params.id,
    p_record_ids: parsed.data.recordIds,
    p_rules: parsed.data.rules,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ colors: data ?? {} });
}
