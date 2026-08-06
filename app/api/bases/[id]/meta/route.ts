import { NextResponse } from "next/server";
import { requireAuth, createClient } from "@/shared/supabase/server";

// GET /api/bases/[id]/meta — the base's tables and fields, for the ERD (and any
// other whole-base schema consumer). Session client, so RLS decides visibility;
// mirrors the shape swamp_api_meta gives token holders.

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const db = createClient();

  const [{ data: tables }, { data: fields }] = await Promise.all([
    db
      .from("tables")
      .select("id, name, sort_order")
      .eq("base_id", params.id)
      .is("deleted_at", null)
      .order("sort_order"),
    db
      .from("fields")
      .select("id, table_id, name, key, type, options, is_primary, sort_order")
      .eq("base_id", params.id)
      .is("deleted_at", null)
      .order("sort_order"),
  ]);

  if (!tables?.length) return NextResponse.json({ error: "not found" }, { status: 404 });

  const byTable = new Map<string, unknown[]>();
  for (const f of fields ?? []) {
    const list = byTable.get(f.table_id as string) ?? [];
    list.push(f);
    byTable.set(f.table_id as string, list);
  }

  return NextResponse.json({
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      fields: byTable.get(t.id as string) ?? [],
    })),
  });
}
