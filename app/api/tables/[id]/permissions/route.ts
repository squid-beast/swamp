import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";
import { PERMISSION_GRANTS, PERMISSION_KEYS, ROLE_ORDER } from "@/features/tables/types";

// Permission rules for one table. RLS is the boundary: `permissions` is
// readable at viewer (the UI has to grey out what you cannot do) and writable
// at creator, the same rung that owns schema.
//
// Correctness does not live here. The rule is enforced by a BEFORE trigger on
// public.records, which fires for every caller — session, token, form, RPC.
// This route only manages the rows.

export const dynamic = "force-dynamic";

const upsertSchema = z
  .object({
    key: z.enum(PERMISSION_KEYS),
    fieldId: z.string().uuid().nullish(),
    grantedType: z.enum(PERMISSION_GRANTS),
    role: z.enum(ROLE_ORDER).nullish(),
    userIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.key === "record_field_edit" && !b.fieldId) {
      ctx.addIssue({ code: "custom", path: ["fieldId"], message: "A field is required" });
    }
    if (b.key !== "record_field_edit" && b.fieldId) {
      ctx.addIssue({ code: "custom", path: ["fieldId"], message: "This rule is table-wide" });
    }
    if (b.grantedType === "role" && !b.role) {
      ctx.addIssue({ code: "custom", path: ["role"], message: "Pick a role" });
    }
    if (b.grantedType === "user" && !b.userIds?.length) {
      ctx.addIssue({ code: "custom", path: ["userIds"], message: "Pick at least one person" });
    }
  });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { data, error } = await createClient()
    .from("permissions")
    .select("id, base_id, table_id, field_id, key, granted_type, role, user_ids")
    .eq("table_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({
    permissions: (data ?? []).map((p) => ({
      id: p.id,
      baseId: p.base_id,
      tableId: p.table_id,
      fieldId: p.field_id,
      key: p.key,
      grantedType: p.granted_type,
      role: p.role,
      userIds: (p.user_ids as string[]) ?? [],
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = upsertSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const db = createClient();

  // ONE statement, one transaction. The route used to DELETE then INSERT over
  // two round trips: the delete committed, and a failed insert left the target
  // with NO rule — silently unprotected, the one direction a permission edit
  // must never fail in. swamp_set_permission is SECURITY INVOKER, so RLS still
  // decides who may write, and it reads base_id off the table rather than the
  // request.
  const { data, error } = await db.rpc("swamp_set_permission", {
    p_table_id: params.id,
    p_key: parsed.data.key,
    p_field_id: parsed.data.fieldId ?? null,
    p_granted_type: parsed.data.grantedType,
    p_role: parsed.data.grantedType === "role" ? parsed.data.role : null,
    p_user_ids: parsed.data.grantedType === "user" ? (parsed.data.userIds ?? []) : [],
  });

  if (error) {
    // RLS refuses below creator; the field guard refuses a rule on a field whose
    // value is not stored; 42P01 means the table is gone.
    const status = error.code === "42P01" ? 404 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ id: data as string }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get("ruleId");
  if (!id) return NextResponse.json({ error: "ruleId is required" }, { status: 400 });

  const { error } = await createClient()
    .from("permissions")
    .delete()
    .eq("id", id)
    .eq("table_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
