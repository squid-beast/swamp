import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/lib/supabase/server";
import { getAccessToken, readSheet, isGoogleConfigured } from "@/lib/google/sheets";
import { ingest } from "@/engine/import";
import { store } from "@/storage/store";

// Create a connection: read the sheet now, infer types, create the dataset +
// rows, and record the connection so it can be synced later.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isGoogleConfigured) {
    return NextResponse.json({ error: "Google Sheets isn't configured on the server." }, { status: 400 });
  }
  const { spreadsheetId, sheetTitle, name } = await req.json();
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
    const table = await readSheet(token, spreadsheetId, sheetTitle);
    if (!table.columns.length) {
      return NextResponse.json({ error: "That tab has no header row." }, { status: 400 });
    }
    const { dataset, rows } = ingest(name || sheetTitle, { kind: "sheet", ref: spreadsheetId }, table);
    await store.create(dataset, rows);

    const connId = `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const { error } = await supabase.from("sheet_connections").insert({
      id: connId,
      owner_id: userId,
      dataset_id: dataset.id,
      spreadsheet_id: spreadsheetId,
      sheet_title: sheetTitle,
      last_row_count: rows.length,
      last_synced_at: new Date().toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ datasetId: dataset.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
