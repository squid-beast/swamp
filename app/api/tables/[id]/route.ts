import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteTable, updateTable } from "@/features/tables/schema-ops";
import { apiError } from "@/features/tables/rest";
import { requireAuth } from "@/shared/supabase/server";

// Rename or delete a table.
//
// `updateTable` and `deleteTable` have existed in the data layer since the schema
// rebuild with ZERO callers — there was no route, and no server action anywhere in
// the app, so a table could be created and then never renamed or removed. This is
// that route.
//
// Deletion is soft (see deleteTable). Authorization is RLS's — creator and up.

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await updateTable(params.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await deleteTable(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
