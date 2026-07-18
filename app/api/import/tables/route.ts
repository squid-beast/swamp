import { NextResponse } from "next/server";
import { listBases, listTables } from "@/features/tables/repo";
import { requireAuth } from "@/shared/supabase/server";

// The tables a user could import into — every table across their bases — for the
// "existing table" destination picker. RLS scopes both queries to what they can see.

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const bases = await listBases();
  const perBase = await Promise.all(
    bases.map(async (b) => {
      const tables = await listTables(b.id);
      return tables.map((t) => ({ id: t.id, name: t.name, baseId: b.id, baseName: b.name }));
    })
  );

  return NextResponse.json({ tables: perBase.flat() });
}
