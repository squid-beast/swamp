import "server-only";
import { createClient } from "@/shared/supabase/server";
import { listFields, insertRecords, updateRecords, sanitizeValues, type WriteError } from "./repo";
import { coercePasted } from "./clipboard";
import { isReadOnlyField, type FieldType } from "./types";
import { ImportError, MAX_IMPORT_ROWS, MAX_IMPORT_COLS } from "./import-service";

// ════════════════════════════════════════════════════════════════════════════
// Import INTO an existing table: upsert by a key column the user picks.
//
// The Sheets re-sync reconciles by a row's POSITION in the sheet; this reconciles
// by a VALUE — Email, ID, whatever — so a re-import of an edited export updates the
// rows it matches and adds the rest. Rows in the table but absent from the import
// are LEFT ALONE (an import is not a mirror).
//
// The whole risk of this feature is a WRONG match silently corrupting a real table,
// so the matching is deliberately careful: normalize keys by type (so "007" matches
// "7" and "Jane@x" matches "jane@x"), read every existing row (not just the first
// page PostgREST returns), refuse an ambiguous key, and dedupe the incoming rows.
// ════════════════════════════════════════════════════════════════════════════

export interface UpsertResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
}

// Compare keys by their MEANING, not their formatting. A raw string compare would
// treat "007"/"7", "Jane@x"/"jane@x", and "01/05/2024"/"2024-01-05" as different
// keys and duplicate the row instead of updating it.
function keyNorm(type: FieldType, v: unknown): string {
  const s = String(v ?? "").trim();
  if (s === "") return "";
  switch (type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "year":
    case "duration": {
      const n = Number(s.replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? String(n) : s.toLowerCase();
    }
    case "boolean":
      return /^(true|1|yes|y)$/i.test(s) ? "true" : /^(false|0|no|n)$/i.test(s) ? "false" : s.toLowerCase();
    case "date":
    case "datetime": {
      const t = Date.parse(s);
      return Number.isFinite(t) ? new Date(t).toISOString().slice(0, type === "date" ? 10 : 19) : s.toLowerCase();
    }
    default:
      return s.toLowerCase();
  }
}

// Every existing row, in pages. A single select is capped by PostgREST's db-max-rows
// (often 1000), and a truncated index would silently INSERT a duplicate for every
// row past the cap instead of updating it.
async function readAllRows(tableId: string): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const db = createClient();
  const PAGE = 1000;
  const out: { id: string; data: Record<string, unknown> }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("records")
      .select("id, data")
      .eq("table_id", tableId)
      .is("deleted_at", null)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) throw new ImportError("Couldn't read the destination table.");
    const page = (data ?? []) as { id: string; data: Record<string, unknown> }[];
    out.push(...page);
    if (page.length < PAGE) break;
    if (out.length > MAX_IMPORT_ROWS) throw new ImportError("That table is too large to import into.");
  }
  return out;
}

export async function upsertIntoTable(
  tableId: string,
  keyFieldKey: string,
  /** source column name → destination field key ("" / absent = skip). */
  mapping: Record<string, string>,
  columns: string[],
  rows: Record<string, unknown>[]
): Promise<UpsertResult> {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportError(
      `That's ${rows.length.toLocaleString()} rows — imports are capped at ${MAX_IMPORT_ROWS.toLocaleString()}.`
    );
  }
  if (columns.length > MAX_IMPORT_COLS) {
    throw new ImportError(`That's ${columns.length} columns — imports are capped at ${MAX_IMPORT_COLS}.`);
  }

  const fields = await listFields(tableId);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const keyField = byKey.get(keyFieldKey);
  if (!keyField) throw new ImportError("Choose a match column that exists in the table.");
  if (isReadOnlyField(keyField.type)) throw new ImportError("The match column can't be a computed field.");

  const baseId = fields[0]?.baseId;
  if (!baseId) throw new ImportError("That table has no columns to import into.");

  // The source column feeding the key must still be present — a URL re-fetched at
  // apply time (Google Sheet, etc.) could have changed its headers since preview,
  // which would otherwise silently skip every row and report a bogus "0 · 0".
  const keySource = Object.entries(mapping).find(([, dest]) => dest === keyFieldKey)?.[0];
  if (!keySource) throw new ImportError("Map one of your columns to the match field, so rows can be matched.");
  if (!columns.includes(keySource)) {
    throw new ImportError(`The source no longer has the “${keySource}” column the match is built on — start over.`);
  }

  // Existing rows, indexed by normalized key. Refuse an AMBIGUOUS key (the table
  // already has two rows with the same value) rather than silently update one of them.
  const existing = await readAllRows(tableId);
  const idByKey = new Map<string, string>();
  for (const r of existing) {
    const k = keyNorm(keyField.type, r.data[keyFieldKey]);
    if (k === "") continue;
    if (idByKey.has(k)) {
      throw new ImportError(
        `The match column “${keyField.name}” has duplicate values in the table (e.g. “${String(r.data[keyFieldKey])}”). Pick a column with unique values.`
      );
    }
    idByKey.set(k, r.id);
  }

  // Build one coerced values object per source row, and DEDUPE the incoming rows by
  // key (last wins) — two source rows with the same key must not create a duplicate
  // or collide inside a single patch call.
  const byIncomingKey = new Map<string, Record<string, unknown>>();
  let skipped = 0;
  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const [src, dest] of Object.entries(mapping)) {
      if (!dest) continue;
      const field = byKey.get(dest);
      if (!field || isReadOnlyField(field.type)) continue;
      const raw = row[src];
      if (raw == null || raw === "") continue;
      values[dest] = coercePasted(field.type, String(raw));
    }
    const k = keyNorm(keyField.type, values[keyFieldKey]);
    if (k === "") {
      skipped++; // no key value → nothing to match on
      continue;
    }
    byIncomingKey.set(k, values);
  }

  if (byIncomingKey.size === 0 && rows.length > 0) {
    throw new ImportError("None of the rows had a value in the match column.");
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  for (const [k, values] of byIncomingKey) {
    const id = idByKey.get(k);
    if (id) updates.push({ id, values });
    else inserts.push(values);
  }

  // Validate EVERYTHING before writing anything, so a bad cell aborts before we
  // touch the DB rather than leaving half the import applied.
  const errors: WriteError[] = [];
  [...inserts, ...updates.map((u) => u.values)].forEach((v, i) => {
    errors.push(...sanitizeValues(fields, v, i).errors);
  });
  if (errors.length) {
    const e = errors[0];
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
    throw new ImportError(`${e.field}: ${e.error}${more}.`);
  }

  // Two writes (one bulk insert, one bulk patch). They are not a single transaction;
  // if the second fails after the first commits, some rows are applied. Upsert is
  // idempotent, so re-running reconciles — surface that honestly rather than claim a
  // total failure the table doesn't reflect.
  let added = 0;
  try {
    if (inserts.length) {
      const r = await insertRecords(tableId, baseId, inserts);
      if (r.errors.length) throw new ImportError(`${r.errors[0].field}: ${r.errors[0].error}.`);
      added = r.records.length;
    }
    if (updates.length) {
      const r = await updateRecords(tableId, updates);
      if (r.errors.length) throw new ImportError(`${r.errors[0].field}: ${r.errors[0].error}.`);
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (added > 0) {
      throw new ImportError(`Added ${added} rows, but updating the rest failed. It's safe to run the import again to finish.`);
    }
    throw new ImportError("The import couldn't be saved. Try again.");
  }

  return { added, updated: updates.length, skipped, total: rows.length };
}
