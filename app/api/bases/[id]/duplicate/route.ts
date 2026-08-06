import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";

// Duplicate a whole base — schema only ("template my base"). SECURITY INVOKER
// underneath: RLS gates every insert, so this grants nothing the caller lacks.

export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string().trim().min(1).max(120).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { data, error } = await createClient().rpc("swamp_duplicate_base", {
    p_base_id: params.id,
    p_name: parsed.data.name ?? null,
  });

  if (error) {
    const status = error.code === "42P01" ? 404 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ baseId: data as string }, { status: 201 });
}
