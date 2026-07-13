import { NextRequest, NextResponse } from "next/server";
import { createClient, getUserId } from "@/shared/supabase/server";
import { getAccessToken, readSheet } from "@/features/sheets/google/sheets";
import { sheetRowsToRows } from "@/features/sheets/lib/rows";
import { store } from "@/features/datasets/storage/store";

// Manual "Sync now" — runs in the user's session, so RLS covers the write.
// Appends sheet rows beyond what's already been ingested.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { datasetId } = await req.json();
  if (!datasetId) return NextResponse.json({ error: "Missing datasetId" }, { status: 400 });

  const supabase = createClient();
  const { data: conn } = await supabase
    .from("sheet_connections")
    .select("*")
    .eq("dataset_id", datasetId)
    .maybeSingle();
  if (!conn) return NextResponse.json({ error: "This dataset has no sheet connection." }, { status: 404 });

  const { data: cred } = await supabase
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cred?.refresh_token) {
    return NextResponse.json({ error: "Reconnect your Google account." }, { status: 400 });
  }

  const ds = await store.get(datasetId);
  if (!ds) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const token = await getAccessToken(cred.refresh_token);
    const table = await readSheet(token, conn.spreadsheet_id, conn.sheet_title);
    const total = table.rows.length;
    if (total <= conn.last_row_count) {
      return NextResponse.json({ added: 0, total });
    }
    const newSheetRows = table.rows.slice(conn.last_row_count);
    const newRows = sheetRowsToRows(ds.fields, newSheetRows, conn.last_row_count);
    const payload = newRows.map((r, i) => {
      const { __id, ...data } = r;
      return { dataset_id: datasetId, row_id: __id, ord: conn.last_row_count + i, data };
    });
    const { error: insErr } = await supabase
      .from("dataset_rows")
      .upsert(payload, { onConflict: "dataset_id,row_id", ignoreDuplicates: true });
    if (insErr) throw insErr;
    await supabase
      .from("datasets")
      .update({ row_count: total, updated_at: new Date().toISOString() })
      .eq("id", datasetId);
    await supabase
      .from("sheet_connections")
      .update({ last_row_count: total, last_synced_at: new Date().toISOString() })
      .eq("id", conn.id);
    return NextResponse.json({ added: newRows.length, total });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
