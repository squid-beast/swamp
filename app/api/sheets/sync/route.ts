import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, readSheet, isGoogleConfigured } from "@/features/sheets/google/sheets";
import { syncSheetToTable, type SheetField } from "@/features/sheets/sync-service";
import { getTable, listFields } from "@/features/tables/repo";

// Re-sync a connected sheet.
//
// Reconciles: new rows insert, changed rows update, removed rows soft-delete.
// The old implementation only appended rows past a high-water mark — an edit in
// the sheet never reached SWAMP, and a deletion never did either. It looked fine
// and was quietly wrong.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isGoogleConfigured) {
    return NextResponse.json({ error: "Google Sheets isn't configured." }, { status: 400 });
  }

  const { tableId } = await req.json();
  if (!tableId) return NextResponse.json({ error: "Missing tableId" }, { status: 400 });

  const supabase = createClient();

  const { data: conn } = await supabase
    .from("sheet_connections")
    .select("id, spreadsheet_id, sheet_title")
    .eq("table_id", tableId)
    .maybeSingle();
  if (!conn) {
    return NextResponse.json({ error: "This table has no sheet connection." }, { status: 404 });
  }

  const { data: cred } = await supabase
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cred?.refresh_token) {
    return NextResponse.json({ error: "Reconnect your Google account." }, { status: 400 });
  }

  try {
    const table = await getTable(tableId);
    if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

    const fields = await listFields(tableId);
    const token = await getAccessToken(cred.refresh_token);
    const sheet = await readSheet(token, conn.spreadsheet_id, conn.sheet_title);

    // Match sheet columns to fields by the header they came from. A field renamed
    // in SWAMP still tracks the same sheet column — which is the entire point of
    // `key` being stable while `name` is free.
    const mapped: SheetField[] = fields.map((f) => ({
      key: f.key,
      sourceName:
        sheet.columns.find(
          (c) =>
            c === f.name ||
            c.toLowerCase().replace(/[_-]+/g, " ") === f.name.toLowerCase()
        ) ?? f.name,
      type: f.type,
    }));

    const result = await syncSheetToTable(
      supabase,
      tableId,
      table.baseId,
      mapped,
      sheet.rows as Record<string, string>[]
    );

    await supabase
      .from("sheet_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", conn.id);

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
