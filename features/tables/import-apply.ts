import "server-only";
import { importTable } from "./import-service";
import { upsertIntoTable } from "./upsert-service";
import type { ParsedTable } from "./engine/import";

// Where an import lands. Both the file route and the URL route funnel through here so
// "new table vs existing table" is decided in one place, not duplicated per source.
export interface ImportDestination {
  baseId?: string;
  /** Present → upsert into this existing table instead of creating a new one. */
  tableId?: string;
  keyField?: string;
  mapping?: Record<string, string>;
}

export type ApplyResult =
  | { mode: "new"; tableId: string; rowCount: number; fieldCount: number }
  | { mode: "upsert"; tableId: string; added: number; updated: number; skipped: number; total: number };

export async function applyImport(
  name: string,
  parsed: ParsedTable,
  dest: ImportDestination
): Promise<ApplyResult> {
  if (dest.tableId) {
    const r = await upsertIntoTable(
      dest.tableId,
      dest.keyField ?? "",
      dest.mapping ?? {},
      parsed.columns,
      parsed.rows
    );
    return { mode: "upsert", tableId: dest.tableId, ...r };
  }
  const r = await importTable(name, parsed, { baseId: dest.baseId });
  return { mode: "new", tableId: r.tableId, rowCount: r.rowCount, fieldCount: r.fieldCount };
}
