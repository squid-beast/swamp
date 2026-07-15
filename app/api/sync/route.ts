import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAccessToken, readSheet, isGoogleConfigured } from "@/features/sheets/google/sheets";
import { syncSheetToTable, type SheetField } from "@/features/sheets/sync-service";
import { SUPABASE_URL } from "@/shared/supabase/env";

// Vercel cron: re-sync every connected sheet.
//
// This is the one place a service-role client is legitimate — there is no user
// session on a cron invocation, so RLS has nobody to scope to. It is gated on
// CRON_SECRET and it is the ONLY route in the app that touches the service key.
//
// The schedule is every 15 minutes, not every minute. The old one ran a serial
// scan with a Google token refresh and a full sheet read PER CONNECTION, sixty
// times an hour. That does not survive fifty users.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SERVICE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }
  if (!isGoogleConfigured) {
    return NextResponse.json({ skipped: "google not configured" });
  }

  const db = createServiceClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: connections, error } = await db
    .from("sheet_connections")
    .select("id, owner_id, table_id, spreadsheet_id, sheet_title");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { id: string; ok: boolean; detail?: unknown }[] = [];

  for (const conn of connections ?? []) {
    try {
      const { data: cred } = await db
        .from("google_credentials")
        .select("refresh_token")
        .eq("user_id", conn.owner_id)
        .maybeSingle();
      if (!cred?.refresh_token) {
        results.push({ id: conn.id, ok: false, detail: "no google credential" });
        continue;
      }

      const { data: table } = await db
        .from("tables")
        .select("id, base_id")
        .eq("id", conn.table_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!table) {
        results.push({ id: conn.id, ok: false, detail: "table gone" });
        continue;
      }

      const { data: fields } = await db
        .from("fields")
        .select("key, name, type")
        .eq("table_id", conn.table_id)
        .is("deleted_at", null)
        .order("sort_order");

      const token = await getAccessToken(cred.refresh_token);
      const sheet = await readSheet(token, conn.spreadsheet_id, conn.sheet_title);

      const mapped: SheetField[] = (fields ?? []).map((f) => ({
        key: f.key as string,
        sourceName:
          sheet.columns.find(
            (c) =>
              c === f.name ||
              c.toLowerCase().replace(/[_-]+/g, " ") === String(f.name).toLowerCase()
          ) ?? (f.name as string),
        type: f.type as SheetField["type"],
      }));

      const result = await syncSheetToTable(
        db,
        conn.table_id,
        table.base_id as string,
        mapped,
        sheet.rows as Record<string, string>[]
      );

      await db
        .from("sheet_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", conn.id);

      results.push({ id: conn.id, ok: true, detail: result });
    } catch (e) {
      // One bad connection must not stop the rest. A revoked Google token on one
      // user's sheet is not a reason to stop syncing everyone else's.
      results.push({ id: conn.id, ok: false, detail: (e as Error).message });
    }
  }

  return NextResponse.json({ synced: results.length, results });
}
