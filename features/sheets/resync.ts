import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken, readSheet } from "@/features/sheets/google/sheets";
import { syncSheetToTable, type SheetField, type SyncResult } from "@/features/sheets/sync-service";
import { getTable, listFields } from "@/features/tables/repo";

// ════════════════════════════════════════════════════════════════════════════
// Resync one connected table from its Google Sheet.
//
// The same steps were written out twice — once in the user-triggered route
// (/api/sheets/sync) and once inline in the table page's auto-refresh. This is
// the single copy. The cron (/api/sync) keeps its own service-role loop because
// it runs without a user session and reconciles every connection at once.
// ════════════════════════════════════════════════════════════════════════════

export type ResyncOutcome =
  | { status: "synced"; result: SyncResult }
  | { status: "skipped"; reason: "fresh" }
  | { status: "no-connection" };

/**
 * Pull the latest sheet contents into `tableId` using the caller's RLS-scoped
 * client and their Google refresh token.
 *
 * `minIntervalMs` makes the sync a no-op when the connection was synced very
 * recently — so opening/refreshing a table can safely trigger a sync on every
 * load without hammering Google. Omit it (or pass 0) to always sync.
 */
export async function resyncSheetTable(
  supabase: SupabaseClient,
  tableId: string,
  refreshToken: string,
  opts: { minIntervalMs?: number } = {}
): Promise<ResyncOutcome> {
  const { data: conn } = await supabase
    .from("sheet_connections")
    .select("id, spreadsheet_id, sheet_title, last_synced_at")
    .eq("table_id", tableId)
    .maybeSingle();
  if (!conn) return { status: "no-connection" };

  if (opts.minIntervalMs && conn.last_synced_at) {
    const age = Date.now() - new Date(conn.last_synced_at as string).getTime();
    if (age < opts.minIntervalMs) return { status: "skipped", reason: "fresh" };
  }

  const table = await getTable(tableId);
  if (!table) return { status: "no-connection" };
  const fields = await listFields(tableId);

  const token = await getAccessToken(refreshToken);
  const sheet = await readSheet(
    token,
    conn.spreadsheet_id as string,
    conn.sheet_title as string
  );

  // Match sheet columns to fields by the header they came from — a field renamed
  // in SWAMP still tracks its original sheet column, which is the whole point of
  // `key` being stable while `name` is free.
  const mapped: SheetField[] = fields.map((f) => ({
    key: f.key,
    sourceName:
      sheet.columns.find(
        (c) =>
          c === f.name ||
          c.toLowerCase().replace(/[_-]+/g, " ") === f.name.toLowerCase()
      ) ?? f.name,
    type: f.type,
  }));

  const result = await syncSheetToTable(
    supabase,
    tableId,
    table.baseId,
    mapped,
    sheet.rows as Record<string, string>[]
  );

  await supabase
    .from("sheet_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", conn.id);

  return { status: "synced", result };
}
