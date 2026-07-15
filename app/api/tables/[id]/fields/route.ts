import { NextRequest, NextResponse } from "next/server";
import { getTable, listFields } from "@/features/tables/repo";
import { createField, reorderFields } from "@/features/tables/schema-ops";
import { createFieldSchema } from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";
import { z } from "zod";

// Fields for a table.
//
// Gated at CREATOR by RLS, not by a check here. An editor's call simply fails at
// the database — which is the right place for it, because it also covers the API
// routes nobody remembered to guard.

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json({ fields: await listFields(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = createFieldSchema
    .omit({ tableId: true })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const table = await getTable(params.id);
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const field = await createField(params.id, table.baseId, parsed.data);
    return NextResponse.json({ field });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

const reorderSchema = z.object({
  order: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number() })).min(1),
});

export async function PATCH(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = reorderSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await reorderFields(parsed.data.order);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
