import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, readSheet, isGoogleConfigured, hasSheetsScope } from "@/features/sheets/google/sheets";
import { importTable, ImportError } from "@/features/tables/import-service";
import { upsertIntoTable } from "@/features/tables/upsert-service";

// Connect a Google Sheet: read it once, then either create a new (live-synced) table
// or upsert its rows into an existing table.
//
// The import itself is the SAME path a CSV takes — there is one importer, and a sheet
// is just another source for it.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  if (!isGoogleConfigured) {
    return NextResponse.json({ error: "Google Sheets isn't configured on the server." }, { status: 400 });
  }

  const { spreadsheetId, sheetTitle, name, baseName, baseId, tableId, keyField, mapping } = await req.json();
  if (!spreadsheetId || !sheetTitle) {
    return NextResponse.json({ error: "Pick a spreadsheet and a tab." }, { status: 400 });
  }

  const supabase = createClient();
  const { data: cred } = await supabase
    .from("google_credentials")
    .select("refresh_token, scope")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cred?.refresh_token || !hasSheetsScope(cred.scope)) {
    return NextResponse.json({ error: "Connect Google with Sheets access first." }, { status: 400 });
  }

  try {
    const token = await getAccessToken(cred.refresh_token);
    const parsed = await readSheet(token, spreadsheetId, sheetTitle);
    if (!parsed.columns.length) {
      return NextResponse.json({ error: "That tab has no header row." }, { status: 400 });
    }

    // Into an existing table: a ONE-SHOT upsert by key, no live-sync connection. The
    // connector's live sync reconciles by sheet ROW POSITION, which is incompatible
    // with matching an existing table by a chosen key column — so we don't set one up.
    if (typeof tableId === "string" && tableId) {
      const r = await upsertIntoTable(
        tableId,
        typeof keyField === "string" ? keyField : "",
        mapping && typeof mapping === "object" ? mapping : {},
        parsed.columns,
        parsed.rows
      );
      return NextResponse.json({ mode: "upsert", tableId, ...r });
    }

    // New table: import it and record the connection so it re-syncs.
    //
    // Into a NEW base, the base is named after the spreadsheet's file title and the
    // table after the tab — so a one-sheet import doesn't show the same name twice,
    // nested. When appending to an EXISTING base (baseId set), only the table is
    // created, named after the tab (or the user's chosen name).
    const tableName = name || sheetTitle;
    const result = await importTable(
      baseId ? tableName : baseName || tableName,
      parsed,
      { baseId, tableName }
    );
    const { error } = await supabase.from("sheet_connections").insert({
      id: `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      owner_id: userId,
      table_id: result.tableId,
      spreadsheet_id: spreadsheetId,
      sheet_title: sheetTitle,
      last_synced_at: new Date().toISOString(),
    });
    if (error) throw error;

    return NextResponse.json({ mode: "new", ...result });
  } catch (e) {
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = (e as Error).message;
    if (msg.includes("(403)")) {
      return NextResponse.json(
        { error: "Google denied access. Reconnect Google to grant Sheets access, or check the sheet is shared." },
        { status: 403 }
      );
    }
    console.error("sheets/connect failed:", e);
    return NextResponse.json({ error: "Couldn't connect that sheet. Try again." }, { status: 502 });
  }
}
