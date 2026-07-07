import { NextRequest, NextResponse } from "next/server";
import { store } from "@/storage/store";
import { requireAuth } from "@/lib/supabase/server";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const ds = await store.get(params.id);
  if (!ds) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = await store.getRows(params.id);
  return NextResponse.json({ dataset: ds, rows });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await req.json();
  if (typeof body.name === "string" && body.name.trim())
    await store.rename(params.id, body.name.trim());
  if (body.overrides) await store.saveOverrides(params.id, body.overrides);
  if (body.views) await store.saveViews(params.id, body.views);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;
  await store.remove(params.id);
  return NextResponse.json({ ok: true });
}
