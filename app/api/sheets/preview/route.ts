import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, readSheet, isGoogleConfigured, hasSheetsScope } from "@/features/sheets/google/sheets";

// A tab's columns + a few sample rows, for the connect flow's destination/mapping
// step — the authenticated-sheet equivalent of /api/import/preview.

export const dynamic = "force-dynamic";

const SAMPLE = 5;

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isGoogleConfigured) {
    return NextResponse.json({ error: "Google Sheets isn't configured on the server." }, { status: 400 });
  }

  const { spreadsheetId, sheetTitle } = await req.json();
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
    return NextResponse.json({
      columns: parsed.columns,
      sample: parsed.rows.slice(0, SAMPLE),
      rowCount: parsed.rows.length,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("(403)")) {
      return NextResponse.json(
        { error: "Google denied access. Reconnect Google to grant Sheets access." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
