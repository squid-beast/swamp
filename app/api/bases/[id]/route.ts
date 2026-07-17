import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteBase, updateBase } from "@/features/tables/repo";
import { apiError } from "@/features/tables/rest";
import { requireAuth } from "@/shared/supabase/server";

// Rename or delete a base.
//
// Neither existed — not the route, and not the data-layer function. Meanwhile the
// members panel has been telling users an Owner "can also delete the base", which
// was not true of any code path in the app.
//
// ── The two authorities are different, and only one of them is RLS's ──
//
// Rename is creator-and-up: "bases: creator update" covers it, so PATCH needs no
// check here.
//
// Delete is owner-only — but soft delete is an UPDATE, so it goes through that same
// creator policy. RLS alone would let a creator tombstone a base. The rule is
// enforced by the `bases_guard_soft_delete` trigger instead, which sees the
// deleted_at transition and every caller (20260716000000_object_management.sql).
// A creator gets 42501 from Postgres, which `apiError` renders as 403. So there is
// deliberately no owner check in this file: the boundary is the database, and a
// check here would be a duplicate that can drift.

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: z.string().max(80).nullable(),
    color: z.string().max(40).nullable(),
  })
  .partial()
  .strict();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await updateBase(params.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await deleteBase(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
