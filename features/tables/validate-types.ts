import type { FieldType, SelectOption } from "./types";

/**
 * The minimum a value validator needs to know about a field.
 *
 * Deliberately narrower than `Field`. Validation runs in three places — the grid,
 * the record form, and the API write path — and two of those don't have a
 * database row in hand. Taking the whole `Field` would force callers to fabricate
 * a UUID and a table_id just to check whether "banana" is a number.
 */
export interface ValidatableField {
  type: FieldType;
  options?: SelectOption[];
  currency?: string;
}
