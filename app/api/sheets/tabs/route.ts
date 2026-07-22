import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, getSpreadsheetInfo, parseSpreadsheetId, isGoogleConfigured, hasSheetsScope } from "@/features/sheets/google/sheets";

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
    const { title, tabs } = await getSpreadsheetInfo(token, spreadsheetId);
    return NextResponse.json({ spreadsheetId, title, tabs });
  } catch (e) {
    const msg = (e as Error).message;
    // A 403 from Google means the token can't read this sheet. There are three real
    // causes and they need different fixes, so surface Google's own reason:
    //   • "…API has not been used in project… or it is disabled" → enable the
    //     Google Sheets API in Cloud Console (most common on a new project).
    //   • "The caller does not have permission" → the connected Google account
    //     isn't shared on this sheet (or it's the wrong account).
    //   • "insufficient authentication scopes" → reconnect to grant Sheets read.
    if (msg.includes("(403)")) {
      const disabled = /has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg);
      return NextResponse.json(
        {
          error: disabled
            ? "The Google Sheets API isn't enabled for this app's Google Cloud project. Enable it in Google Cloud Console → APIs & Services → Library → Google Sheets API."
            : "Google denied access to this sheet. Make sure the sheet is shared with the connected Google account, or reconnect Google to grant Sheets access.",
          detail: msg,
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
