import "server-only";
import { createClient } from "@/shared/supabase/server";
import { inferFields } from "./engine/inference";
import { parseCSV, parseJSON, parseXLSX, type ParsedTable } from "./engine/import";
import { deriveFieldKey } from "./repo";
import type { FieldType } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Import: a file in, a real table out.
//
// The old ingest() built a `Dataset` object — fields and views as JSONB blobs on
// one row, field ids from a module-level counter. This creates actual rows:
// a base (if needed), a table, one `fields` row per column, a default grid view,
// and one `records` row per line.
//
// Everything happens through the RLS-scoped client. No service-role bypass.
// ════════════════════════════════════════════════════════════════════════════

const ROW_CHUNK = 500;

// Imports are bounded so one pasted link can't turn into 10M sequential inserts that
// blow the function's 60s budget and leave a half-created table behind. Generous
// enough for real spreadsheets; a hard stop for the pathological ones.
export const MAX_IMPORT_ROWS = 500_000;
export const MAX_IMPORT_COLS = 512;

/** A message that is safe to show the user. Everything else (raw DB errors, bugs)
 *  is logged server-side and genericised at the route, so schema and policy names
 *  never reach the client. */
export class ImportError extends Error {}

export interface ImportResult {
  baseId: string;
  tableId: string;
  viewId: string;
  rowCount: number;
  fieldCount: number;
}

export function parseFile(filename: string, buf: ArrayBuffer, text: string): ParsedTable {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseXLSX(buf);
  if (lower.endsWith(".json")) return parseJSON(text);
  return parseCSV(text);
}

/** The workspace to put a new base in. Every user has one — the signup trigger
 *  guarantees it, so there is no "no workspace" branch to handle. */
async function defaultWorkspaceId(): Promise<string> {
  const { data, error } = await createClient()
    .from("workspace_members")
    .select("workspace_id")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`workspace lookup failed: ${error.message}`);
  if (!data) throw new Error("no workspace — the signup bootstrap did not run");
  return data.workspace_id as string;
}

/**
 * Values are keyed by field.key, and a multiSelect is stored as a JSON ARRAY.
 *
 * Not a comma-joined string. The inference engine detects a multiSelect by seeing
 * commas in the source, so the source value IS a string — this is where it becomes
 * an array, once, at the boundary. Get this wrong and every `anyof` filter in the
 * product falls back to a LIKE over a delimited blob.
 */
function toRecordData(
  parsed: ParsedTable,
  row: Record<string, unknown>,
  fields: { key: string; sourceName: string; type: FieldType }[]
): Record<string, unknown> {
  void parsed;
  const data: Record<string, unknown> = {};

  for (const f of fields) {
    const raw = row[f.sourceName];
    if (raw == null || raw === "") continue; // don't store empty keys — absent is absent

    if (f.type === "multiSelect") {
      data[f.key] = String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      data[f.key] = raw;
    }
  }

  return data;
}

export async function importTable(
  name: string,
  parsed: ParsedTable,
  opts: { baseId?: string } = {}
): Promise<ImportResult> {
  // Reject oversized imports BEFORE creating anything, so a rejection never leaves an
  // orphaned base/table behind.
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new ImportError(
      `That's ${parsed.rows.length.toLocaleString()} rows — imports are capped at ${MAX_IMPORT_ROWS.toLocaleString()}. Split it and try again.`
    );
  }
  if (parsed.columns.length > MAX_IMPORT_COLS) {
    throw new ImportError(
      `That's ${parsed.columns.length} columns — imports are capped at ${MAX_IMPORT_COLS}.`
    );
  }

  const db = createClient();

  // ── Base ──
  let baseId = opts.baseId;
  if (!baseId) {
    const workspaceId = await defaultWorkspaceId();
    const { data, error } = await db
      .from("bases")
      .insert({ workspace_id: workspaceId, name })
      .select("id")
      .single();
    if (error) throw new Error(`create base: ${error.message}`);
    baseId = data.id as string;
  }

  // ── Table ──
  const { data: table, error: tableError } = await db
    .from("tables")
    .insert({ base_id: baseId, name })
    .select("id")
    .single();
  if (tableError) throw new Error(`create table: ${tableError.message}`);
  const tableId = table.id as string;

  // ── Fields ──
  const inferred = inferFields(parsed.columns, parsed.rows, parsed.formatHints);

  const taken = new Set<string>();
  const fieldRows = inferred.map((f, i) => {
    const key = deriveFieldKey(f.name, taken);
    taken.add(key);
    return {
      table_id: tableId,
      base_id: baseId,
      name: f.name,
      key,
      type: f.type,
      options: {
        ...(f.options ? { options: f.options } : {}),
        ...(f.currency ? { currency: f.currency } : {}),
      },
      // The first column is the display value — what other tables show when they
      // reference this record. It's a guess, and the user can move it.
      is_primary: i === 0,
      sort_order: i + 1,
    };
  });

  const { error: fieldsError } = await db.from("fields").insert(fieldRows);
  if (fieldsError) throw new Error(`create fields: ${fieldsError.message}`);

  // ── Default view ──
  // Every table has exactly one, and it cannot be deleted. Creating it here means
  // there is never a table with nowhere to look at it.
  const { data: view, error: viewError } = await db
    .from("views")
    .insert({
      table_id: tableId,
      base_id: baseId,
      type: "grid",
      name: "Grid",
      is_default: true,
    })
    .select("id")
    .single();
  if (viewError) throw new Error(`create view: ${viewError.message}`);

  // ── Records ──
  const lookup = fieldRows.map((f, i) => ({
    key: f.key,
    sourceName: inferred[i].sourceName,
    type: f.type as FieldType,
  }));

  let inserted = 0;
  for (let i = 0; i < parsed.rows.length; i += ROW_CHUNK) {
    const chunk = parsed.rows.slice(i, i + ROW_CHUNK).map((row, j) => ({
      table_id: tableId,
      base_id: baseId,
      data: toRecordData(parsed, row, lookup),
      // Integers on import. Fractional ordering only matters once someone drags a
      // row, and a midpoint between 1 and 2 has plenty of room.
      sort_order: i + j + 1,
    }));

    const { error } = await db.from("records").insert(chunk);
    if (error) throw new Error(`insert records (row ${i}): ${error.message}`);
    inserted += chunk.length;
  }

  return {
    baseId,
    tableId,
    viewId: view.id as string,
    rowCount: inserted,
    fieldCount: fieldRows.length,
  };
}
