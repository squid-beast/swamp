import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { groupCounts } from "@/features/tables/repo";
import { querySpecSchema } from "@/features/tables/schema";
import { apiError } from "@/features/tables/rest";
import { requireAuth } from "@/shared/supabase/server";

// The group headers for a grouped view.
//
// Separate from the records read on purpose. The headers describe the whole
// filtered set and change only when the filter, the search or the grouped field
// changes; the rows page underneath them. Folding this into the records response
// would recount every group on every scroll.
//
// Authorization is RLS's: swamp_group_counts is SECURITY INVOKER and its catalog
// lookup fails closed on a table you cannot read.

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  spec: querySpecSchema.optional(),
  field: z.string().min(1).max(80),
  dir: z.enum(["asc", "desc"]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const groups = await groupCounts(
      params.id,
      parsed.data.spec ?? {},
      parsed.data.field,
      parsed.data.dir ?? "asc"
    );
    return NextResponse.json({ groups });
  } catch (e) {
    return apiError(e);
  }
}
