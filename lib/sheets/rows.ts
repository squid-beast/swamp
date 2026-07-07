import { FieldMeta, Row } from "@/core/types";

// Remap sheet rows (keyed by header = field.sourceName) to Row objects keyed by
// field id, continuing ids/ords from ordStart. Used when appending new responses
// to a dataset that already has an inferred field registry.
export function sheetRowsToRows(
  fields: FieldMeta[],
  sheetRows: Record<string, string>[],
  ordStart: number
): Row[] {
  return sheetRows.map((r, i) => {
    const row: Row = { __id: `r_${ordStart + i}` };
    for (const f of fields) row[f.id] = r[f.sourceName] ?? null;
    return row;
  });
}
