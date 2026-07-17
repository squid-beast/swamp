import { NextRequest, NextResponse } from "next/server";
import { createTable } from "@/features/tables/schema-ops";
import { createTableSchema } from "@/features/tables/schema";
import { apiError } from "@/features/tables/rest";
import { requireAuth } from "@/shared/supabase/server";

// Create a table.
//
// Until now the only way to get a table was to import a file or pick a template —
// `createTable` existed and nothing called it. "New table" in the sidebar meant
// "go to the import screen", so a blank table was unreachable.
//
// Authorization is RLS's ("tables: creator write"). Nothing is checked here.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = createTableSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const { tableId, viewId } = await createTable(parsed.data.baseId, parsed.data.name);
    return NextResponse.json({ tableId, viewId }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
