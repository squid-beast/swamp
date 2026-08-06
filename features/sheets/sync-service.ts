import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldType } from "@/features/tables/types";
import {
  getAccessToken,
  isGoogleConfigured,
  readSheet,
} from "@/features/sheets/google/sheets";

// ════════════════════════════════════════════════════════════════════════════
// Google Sheets → a SWAMP table.
//
// Ported off the old `datasets` model. Two things changed beyond the schema:
//
//   1. A connection now points at a TABLE, not a dataset.
//
//   2. Sync is no longer append-only.
//
//      The old sync did `table.rows.slice(conn.last_row_count)` — it took only
//      the rows past the high-water mark. Edit a cell in the sheet and SWAMP
//      never saw it. Delete a row and SWAMP kept it forever. It was a one-way
//      import that called itself a sync, and the divergence was invisible: the
//      grid looked fine, it was just wrong.
//
//      Now every row is keyed by its position in the sheet, and a sync
//      reconciles: new rows insert, changed rows update, removed rows soft-delete.
// ════════════════════════════════════════════════════════════════════════════

/** Where a record came from in the sheet. Stored in `data` under a reserved key. */
const ROW_KEY = "__sheet_row";

export interface SheetField {
  key: string;
  sourceName: string;
  type: FieldType;
}

function toData(
  fields: SheetField[],
  row: Record<string, string>,
  sheetRow: number
): Record<string, unknown> {
  const data: Record<string, unknown> = { [ROW_KEY]: sheetRow };

  for (const f of fields) {
    const raw = row[f.sourceName];
    if (raw == null || raw === "") continue;

    data[f.key] =
      f.type === "multiSelect"
        ? String(raw).split(",").map((s) => s.trim()).filter(Boolean)
        : raw;
  }

  return data;
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/**
 * Reconcile a table against the current contents of a sheet.
 *
 * Uses the caller's RLS-scoped client for the user-triggered path, or a
 * service-role client for the cron. The logic is identical; only who's asking
 * differs.
 */
export async function syncSheetToTable(
  db: SupabaseClient,
  tableId: string,
  baseId: string,
  fields: SheetField[],
  sheetRows: Record<string, string>[]
): Promise<SyncResult> {
  // Existing records, indexed by their sheet row.
  const { data: existing, error } = await db
    .from("records")
    .select("id, data")
    .eq("table_id", tableId)
    .is("deleted_at", null);
  if (error) throw new Error(`sync read: ${error.message}`);

  const byRow = new Map<number, { id: string; data: Record<string, unknown> }>();
  for (const r of existing ?? []) {
    const d = r.data as Record<string, unknown>;
    const n = Number(d[ROW_KEY]);
    if (Number.isFinite(n)) byRow.set(n, { id: r.id as string, data: d });
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const seen = new Set<number>();

  sheetRows.forEach((row, i) => {
    const data = toData(fields, row, i);
    seen.add(i);

    const current = byRow.get(i);
    if (!current) {
      inserts.push({
        table_id: tableId,
        base_id: baseId,
        data,
        sort_order: i + 1,
      });
      return;
    }

    // Only write if something actually changed. A no-op sync that rewrites every
    // row bumps updated_at on the lot, which makes "recently changed" useless and
    // fires realtime for nothing.
    if (JSON.stringify(current.data) !== JSON.stringify(data)) {
      updates.push({ id: current.id, data });
    }
  });

  // Rows that vanished from the sheet. Soft-deleted, not hard — a fat-fingered
  // delete in the sheet should be recoverable from the trash.
  const removedIds = [...byRow.entries()]
    .filter(([row]) => !seen.has(row))
    .map(([, r]) => r.id);

  if (inserts.length) {
    const { error: e } = await db.from("records").insert(inserts);
    if (e) throw new Error(`sync insert: ${e.message}`);
  }

  for (const u of updates) {
    const { error: e } = await db.from("records").update({ data: u.data }).eq("id", u.id);
    if (e) throw new Error(`sync update: ${e.message}`);
  }

  if (removedIds.length) {
    const { error: e } = await db
      .from("records")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", removedIds);
    if (e) throw new Error(`sync delete: ${e.message}`);
  }

  return {
    added: inserts.length,
    updated: updates.length,
    removed: removedIds.length,
    total: sheetRows.length,
  };
}

/**
 * Reconcile EVERY connection — the cron path. Runs on a service-role client
 * because a cron invocation has no user session for RLS to scope to.
 *
 * One bad connection must not stop the rest: a revoked Google token on one
 * user's sheet is not a reason to stop syncing everyone else's.
 */
export async function syncAllConnections(
  db: SupabaseClient
): Promise<
  | { skipped: string }
  | { synced: number; results: { id: string; ok: boolean; detail?: unknown }[] }
> {
  if (!isGoogleConfigured) return { skipped: "google not configured" };

  const { data: connections, error } = await db
    .from("sheet_connections")
    .select("id, owner_id, table_id, spreadsheet_id, sheet_title");
  if (error) throw new Error(error.message);

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
        .select("id, key, name, type")
        .eq("table_id", conn.table_id)
        .is("deleted_at", null)
        .order("sort_order");

      // ── The one place a permission rule has to be honoured in app code ──
      //
      // This loop runs on a SERVICE-ROLE client: RLS is off, and the records
      // trigger exempts service_role because the cron has no user identity. The
      // exemption is right for the system, but the CONTENT here is chosen by a
      // person — the connection's owner picked the table and the sheet — so a
      // locked field would otherwise be writable by connecting a sheet to it.
      //
      // Ask the resolver on the owner's behalf and drop what they may not edit.
      // Dropping rather than failing: one locked column must not stop the other
      // twenty from syncing.
      const writable = new Set<string>();
      for (const f of fields ?? []) {
        const { data: allowed } = await db.rpc("swamp_permission_allows", {
          p_base_id: table.base_id,
          p_table_id: conn.table_id,
          p_key: "record_field_edit",
          p_field_id: f.id,
          p_user_id: conn.owner_id,
        });
        if (allowed !== false) writable.add(f.key as string);
      }

      const token = await getAccessToken(cred.refresh_token);
      const sheet = await readSheet(token, conn.spreadsheet_id, conn.sheet_title);

      const mapped: SheetField[] = (fields ?? [])
        .filter((f) => writable.has(f.key as string))
        .map((f) => ({
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
      results.push({ id: conn.id, ok: false, detail: (e as Error).message });
    }
  }

  return { synced: results.length, results };
}
