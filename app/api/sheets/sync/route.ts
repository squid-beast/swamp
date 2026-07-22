import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { isGoogleConfigured } from "@/features/sheets/google/sheets";
import { resyncSheetTable } from "@/features/sheets/resync";

// Re-sync a connected sheet, on demand.
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

  const { data: cred } = await supabase
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cred?.refresh_token) {
    return NextResponse.json({ error: "Reconnect your Google account." }, { status: 400 });
  }

  try {
    const outcome = await resyncSheetTable(supabase, tableId, cred.refresh_token);
    if (outcome.status === "no-connection") {
      return NextResponse.json({ error: "This table has no sheet connection." }, { status: 404 });
    }
    // A manual sync never skips — minIntervalMs isn't set — so this is always "synced".
    return NextResponse.json(outcome.status === "synced" ? outcome.result : {});
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
