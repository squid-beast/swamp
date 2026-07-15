import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, readSheet, isGoogleConfigured } from "@/features/sheets/google/sheets";
import { importTable } from "@/features/tables/import-service";

// Connect a Google Sheet: read it once, infer every column's type, create the
// table, and record the connection so it can be re-synced.
//
// The import itself is the SAME path a CSV takes — there is one importer, and a
// sheet is just another source for it.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  if (!isGoogleConfigured) {
    return NextResponse.json(
      { error: "Google Sheets isn't configured on the server." },
      { status: 400 }
    );
  }

  const { spreadsheetId, sheetTitle, name, baseId } = await req.json();
  if (!spreadsheetId || !sheetTitle) {
    return NextResponse.json({ error: "Pick a spreadsheet and a tab." }, { status: 400 });
  }

  const supabase = createClient();
  const { data: cred } = await supabase
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (!cred?.refresh_token) {
    return NextResponse.json({ error: "Connect your Google account first." }, { status: 400 });
  }

  try {
    const token = await getAccessToken(cred.refresh_token);
    const parsed = await readSheet(token, spreadsheetId, sheetTitle);
    if (!parsed.columns.length) {
      return NextResponse.json({ error: "That tab has no header row." }, { status: 400 });
    }

    const result = await importTable(name || sheetTitle, parsed, { baseId });

    const { error } = await supabase.from("sheet_connections").insert({
      id: `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      owner_id: userId,
      table_id: result.tableId,
      spreadsheet_id: spreadsheetId,
      sheet_title: sheetTitle,
      last_synced_at: new Date().toISOString(),
    });
    if (error) throw error;

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
