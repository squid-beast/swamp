import type { FieldType, SelectOption } from "../types";

// ── What inference produces. ──
//
// Deliberately NOT a `Field`. A Field is a row in the database with a UUID and a
// table_id; this is a *proposal* made from a file, before anything is persisted.
//
// The old model conflated the two: inference wrote a `FieldMeta` straight into a
// JSONB blob, with an id from a module-level counter (`fidCounter++`), so field
// ids depended on process lifetime and a "user override" layer had to be bolted
// on beside it to let people rename anything.
//
// Now: inference PROPOSES, the `fields` row IS the truth. A rename updates the
// row. There is no second layer to keep in sync.

export interface InferredField {
  /** The column header exactly as it appeared in the source. */
  sourceName: string;
  /** A humanised display name. The user can change this the moment it exists. */
  name: string;
  type: FieldType;
  options?: SelectOption[];
  currency?: string;
  /** JSON blobs are noise in a grid — hide them by default, don't drop them. */
  hidden: boolean;
}

export interface ParsedTable {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
}
