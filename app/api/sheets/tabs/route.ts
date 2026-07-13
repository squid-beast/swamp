import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, listSheetTitles, parseSpreadsheetId, isGoogleConfigured } from "@/features/sheets/google/sheets";

// List a spreadsheet's tab titles for the connect flow.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isGoogleConfigured) {
    return NextResponse.json({ error: "Google Sheets isn't configured on the server." }, { status: 400 });
  }
  const { url } = await req.json();
  const spreadsheetId = parseSpreadsheetId(String(url ?? ""));
  if (!spreadsheetId) {
    return NextResponse.json({ error: "Enter a valid Google Sheets link." }, { status: 400 });
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
    const tabs = await listSheetTitles(token, spreadsheetId);
    return NextResponse.json({ spreadsheetId, tabs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
