import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAccessToken, readSheet } from "@/lib/google/sheets";
import { sheetRowsToRows } from "@/lib/sheets/rows";
import { FieldMeta } from "@/core/types";

// Background poller (Vercel Cron). No user session, so it authenticates to the
// DB through the token-gated security-definer functions using SYNC_JOB_SECRET.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SYNC_SECRET = process.env.SYNC_JOB_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

type DueConn = {
  connection_id: string;
  dataset_id: string;
  spreadsheet_id: string;
  sheet_title: string;
  last_row_count: number;
  refresh_token: string;
  fields: FieldMeta[];
};

export async function GET(req: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "forbidden" }, { status: 401 });
    }
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !SYNC_SECRET) {
    return NextResponse.json({ error: "sync not configured" }, { status: 400 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data: conns, error } = await sb.rpc("sheets_due_connections", { p_secret: SYNC_SECRET });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let scanned = 0;
  let appended = 0;
  for (const c of (conns ?? []) as DueConn[]) {
    scanned++;
    try {
      const token = await getAccessToken(c.refresh_token);
      const table = await readSheet(token, c.spreadsheet_id, c.sheet_title);
      const total = table.rows.length;
      if (total <= c.last_row_count) continue;
      const newRows = sheetRowsToRows(
        c.fields,
        table.rows.slice(c.last_row_count),
        c.last_row_count
      );
      const payload = newRows.map((r, i) => {
        const { __id, ...data } = r;
        return { row_id: __id, ord: c.last_row_count + i, data };
      });
      const { error: applyErr } = await sb.rpc("sheets_apply_sync", {
        p_secret: SYNC_SECRET,
        p_connection_id: c.connection_id,
        p_rows: payload,
        p_total_rows: total,
      });
      if (applyErr) throw applyErr;
      appended += payload.length;
    } catch {
      // one bad connection shouldn't stop the run
    }
  }

  return NextResponse.json({ scanned, appended });
}
