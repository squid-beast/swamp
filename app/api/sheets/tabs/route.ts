import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, listSheetTitles, parseSpreadsheetId, isGoogleConfigured, hasSheetsScope } from "@/features/sheets/google/sheets";

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
    .select("refresh_token, scope")
    .eq("user_id", userId)
    .maybeSingle();
  // No credential, or one left over from a plain sign-in without Sheets scope: send
  // the user to (re)connect rather than let Google 403 halfway through.
  if (!cred?.refresh_token || !hasSheetsScope(cred.scope)) {
    return NextResponse.json(
      { error: "Connect Google with Sheets access first." },
      { status: 400 }
    );
  }
  try {
    const token = await getAccessToken(cred.refresh_token);
    const tabs = await listSheetTitles(token, spreadsheetId);
    return NextResponse.json({ spreadsheetId, tabs });
  } catch (e) {
    const msg = (e as Error).message;
    // A 403 from Google means the token can't read this sheet — a scope or sharing
    // gap, not a server fault. Say so plainly instead of emitting a bare 502.
    if (msg.includes("(403)")) {
      return NextResponse.json(
        {
          error:
            "Google denied access to this sheet. Reconnect Google to grant Sheets access, or make sure the sheet is shared with your account.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
