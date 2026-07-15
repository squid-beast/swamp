import { NextRequest, NextResponse } from "next/server";
import { deleteField, updateField } from "@/features/tables/schema-ops";
import { updateFieldSchema } from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";

// Alter or drop one field.
//
// `key` is deliberately absent from the patch schema. Renaming a field changes
// its display name and nothing else — the key is what lives in every record's
// `data`, and rewriting a million JSONB payloads because someone fixed a typo in
// a column header would be absurd.

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = updateFieldSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await updateField(params.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await deleteField(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
