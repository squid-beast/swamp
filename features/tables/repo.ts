import "server-only";
import { createClient } from "@/shared/supabase/server";
import { validateValue } from "./validate";
import { deriveFieldKey } from "./field-key";
import type { ValidatableField } from "./validate-types";
import {
  isReadOnlyField,
  type Base,
  type Field,
  type FieldType,
  type QueryResult,
  type QuerySpec,
  type Record_,
  type Table,
  type View,
  type Workspace,
} from "./types";

// ════════════════════════════════════════════════════════════════════════════
// The data layer.
//
// Every call goes through the cookie-bound, RLS-scoped Supabase client. There is
// no service-role bypass anywhere in this file, and there should never be one:
// RLS is the security boundary, and a repo that can bypass it is a repo that
// will, eventually, by accident.
//
// ── What replaces StorageAdapter ──
//
// The old interface was:
//
//     getRows(id: string): Promise<Row[]>
//
// No page. No filter. No sort. No projection. Every caller therefore loaded the
// entire table into memory, and the store capped it at 5,000 rows with a SILENT
// truncation — row 5,001 simply did not exist, with no error and no UI signal.
//
// That signature was the ceiling on the whole product. It is replaced by
// `queryRecords(tableId, spec)`, which pushes the filter, the sort, the search
// and the pagination into Postgres and returns one page.
// ════════════════════════════════════════════════════════════════════════════

// Re-exported so callers get it from the repo, where they look for it.
export { deriveFieldKey };

type Row = globalThis.Record<string, unknown>;

function db() {
  return createClient();
}

/** Throw, keeping Postgres's SQLSTATE on the way up.
 *
 *  The code is the difference between "you may not" and "it broke". RLS denials and
 *  the guard triggers raise 42501; without the code every one of them reads as an
 *  unknown failure at the route, and `apiError` (features/tables/rest.ts) — which
 *  already maps 42501 → 403 — has nothing to work with. */
export function fail(
  context: string,
  error: { message: string; code?: string } | null
): never {
  const e = new Error(`${context}: ${error?.message ?? "unknown error"}`) as Error & {
    code?: string;
  };
  if (error?.code) e.code = error.code;
  throw e;
}

// ─── Mapping ────────────────────────────────────────────────────────────────
// The database speaks snake_case; the domain speaks camelCase. Mapping happens
// exactly here, once, so nothing above this file ever sees a `sort_order`.

const toBase = (r: Row): Base => ({
  id: r.id as string,
  workspaceId: r.workspace_id as string,
  name: r.name as string,
  icon: (r.icon as string) ?? null,
  color: (r.color as string) ?? null,
  sortOrder: Number(r.sort_order),
});

const toTable = (r: Row): Table => ({
  id: r.id as string,
  baseId: r.base_id as string,
  name: r.name as string,
  icon: (r.icon as string) ?? null,
  sortOrder: Number(r.sort_order),
});

const toField = (r: Row): Field => ({
  id: r.id as string,
  tableId: r.table_id as string,
  baseId: r.base_id as string,
  name: r.name as string,
  key: r.key as string,
  type: r.type as FieldType,
  options: (r.options as Field["options"]) ?? {},
  isPrimary: !!r.is_primary,
  sortOrder: Number(r.sort_order),
});

const toView = (r: Row): View => ({
  id: r.id as string,
  tableId: r.table_id as string,
  baseId: r.base_id as string,
  type: r.type as View["type"],
  name: r.name as string,
  isDefault: !!r.is_default,
  lockType: r.lock_type as View["lockType"],
  ownerId: (r.owner_id as string) ?? null,
  config: (r.config as View["config"]) ?? {},
  sortOrder: Number(r.sort_order),
});

// ─── Workspaces & bases ─────────────────────────────────────────────────────

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await db().from("workspaces").select("id, name").order("created_at");
  if (error) fail("listWorkspaces", error);
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
}

export async function listBases(): Promise<Base[]> {
  const { data, error } = await db()
    .from("bases")
    .select("id, workspace_id, name, icon, color, sort_order")
    .is("deleted_at", null)
    .order("sort_order");
  if (error) fail("listBases", error);
  return (data ?? []).map(toBase);
}

export async function createBase(workspaceId: string, name: string): Promise<Base> {
  const { data, error } = await db()
    .from("bases")
    .insert({ workspace_id: workspaceId, name })
    .select()
    .single();
  if (error) fail("createBase", error);
  return toBase(data);
}

export async function updateBase(
  baseId: string,
  patch: { name?: string; icon?: string | null; color?: string | null }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.icon !== undefined) row.icon = patch.icon;
  if (patch.color !== undefined) row.color = patch.color;
  if (!Object.keys(row).length) return;

  const { error } = await db().from("bases").update(row).eq("id", baseId);
  if (error) fail("updateBase", error);
}

/** Soft delete, like every other object here — the row is tombstoned, not removed.
 *  A hard delete would cascade through tables → fields → records (see the
 *  `on delete cascade` on tables.base_id) and take the whole base with it, with
 *  nothing to restore from.
 *
 *  Owner-only, but note the check is NOT here: RLS lets a *creator* update a base,
 *  so an app-side check would be a suggestion, not a boundary. The rule lives in the
 *  `bases_guard_soft_delete` trigger (20260716000000_object_management.sql), which
 *  every caller has to go through. A non-owner gets 42501 back from Postgres. */
export async function deleteBase(baseId: string): Promise<void> {
  const { error } = await db()
    .from("bases")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", baseId);
  if (error) fail("deleteBase", error);
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export async function listTables(baseId: string): Promise<Table[]> {
  const { data, error } = await db()
    .from("tables")
    .select("id, base_id, name, icon, sort_order")
    .eq("base_id", baseId)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) fail("listTables", error);
  return (data ?? []).map(toTable);
}

export async function getTable(tableId: string): Promise<Table | null> {
  const { data, error } = await db()
    .from("tables")
    .select("id, base_id, name, icon, sort_order")
    .eq("id", tableId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("getTable", error);
  return data ? toTable(data) : null;
}

// ─── Fields ─────────────────────────────────────────────────────────────────

export async function listFields(tableId: string): Promise<Field[]> {
  const { data, error } = await db()
    .from("fields")
    .select("id, table_id, base_id, name, key, type, options, is_primary, sort_order")
    .eq("table_id", tableId)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) fail("listFields", error);
  return (data ?? []).map(toField);
}

// ─── Views ──────────────────────────────────────────────────────────────────

export async function listViews(tableId: string): Promise<View[]> {
  const { data, error } = await db()
    .from("views")
    .select("id, table_id, base_id, type, name, is_default, lock_type, owner_id, config, sort_order")
    .eq("table_id", tableId)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) fail("listViews", error);
  return (data ?? []).map(toView);
}

// ─── Records: the read path ─────────────────────────────────────────────────

/**
 * One page of records, filtered / sorted / searched IN POSTGRES.
 *
 * The spec is compiled to SQL by `swamp_query_records`, which runs as the caller
 * (SECURITY INVOKER) — so RLS applies exactly as it would to a plain SELECT, and
 * a user cannot query a table they can't read no matter what they send.
 */
export async function queryRecords(
  tableId: string,
  spec: QuerySpec = {}
): Promise<QueryResult> {
  const { data, error } = await db().rpc("swamp_query_records", {
    p_table_id: tableId,
    p_spec: spec,
  });
  if (error) fail("queryRecords", error);

  const result = data as { records: Row[]; next: QueryResult["next"] };
  return {
    records: (result.records ?? []).map(
      (r): Record_ => ({
        id: r.id as string,
        data: (r.data as Row) ?? {},
        sortOrder: Number(r.sortOrder),
        createdAt: r.createdAt as string,
        updatedAt: r.updatedAt as string,
        createdBy: (r.createdBy as string) ?? null,
        updatedBy: (r.updatedBy as string) ?? null,
      })
    ),
    next: result.next ?? null,
  };
}

/**
 * The group headers: distinct values of a field, with counts, over the FILTERED and
 * SEARCHED set.
 *
 * Counting the loaded window instead would report "3" for a group of 3,000 — the
 * same class of lie as summing a column over the current page.
 */
export async function groupCounts(
  tableId: string,
  spec: QuerySpec,
  fieldKey: string,
  dir: "asc" | "desc" = "asc"
): Promise<{ value: unknown; count: number }[]> {
  const { data, error } = await db().rpc("swamp_group_counts", {
    p_table_id: tableId,
    p_spec: spec,
    p_field: fieldKey,
    p_dir: dir,
  });
  if (error) fail("groupCounts", error);
  return (data as { value: unknown; count: number }[]) ?? [];
}

export async function countRecords(tableId: string, spec: QuerySpec = {}): Promise<number> {
  const { data, error } = await db().rpc("swamp_count_records", {
    p_table_id: tableId,
    p_spec: spec,
  });
  if (error) fail("countRecords", error);
  return Number(data);
}

// ─── Records: the write path ────────────────────────────────────────────────

export interface WriteError {
  row: number;
  key: string;
  field: string;
  error: string;
}

/**
 * Validate incoming values against the table's field catalog.
 *
 * Two jobs, and both matter:
 *
 *   1. STRIP unknown keys. A client must not be able to write a key that isn't a
 *      field — that's how you end up with orphaned junk in `data` that no view
 *      renders and no filter can reach.
 *   2. REJECT values that don't fit their field's type. The UI validates too, but
 *      the UI is not a boundary: anything that can be typed can be POSTed. Until
 *      recently this codebase would happily store "banana" in a currency column.
 *
 * Read-only fields (formula, rollup, createdBy, …) are stripped, not rejected —
 * a client echoing back a record it just read shouldn't 400 for including them.
 */
export function sanitizeValues(
  fields: Field[],
  values: Row,
  rowIndex = 0
): { clean: Row; errors: WriteError[] } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const clean: Row = {};
  const errors: WriteError[] = [];

  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) continue; // unknown key: drop it
    if (isReadOnlyField(field.type)) continue; // computed: never writable

    const check: ValidatableField = {
      type: field.type,
      options: field.options.options,
      currency: field.options.currency,
    };

    const result = validateValue(check, value);
    if (!result.valid) {
      errors.push({
        row: rowIndex,
        key,
        field: field.name,
        error: result.error ?? "Invalid value",
      });
      continue;
    }

    clean[key] = value;
  }

  return { clean, errors };
}

export async function insertRecords(
  tableId: string,
  baseId: string,
  rows: Row[]
): Promise<{ records: Record_[]; errors: WriteError[] }> {
  const fields = await listFields(tableId);

  const cleaned: Row[] = [];
  const errors: WriteError[] = [];
  rows.forEach((values, i) => {
    const r = sanitizeValues(fields, values, i);
    errors.push(...r.errors);
    cleaned.push(r.clean);
  });
  if (errors.length) return { records: [], errors };

  // Append after the current last row. Fractional ordering means we only need the
  // max — no renumbering of anything.
  const { data: last } = await db()
    .from("records")
    .select("sort_order")
    .eq("table_id", tableId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  let order = last ? Number(last.sort_order) : 0;

  const { data, error } = await db()
    .from("records")
    .insert(
      cleaned.map((data_) => ({
        table_id: tableId,
        base_id: baseId,
        data: data_,
        sort_order: ++order,
      }))
    )
    .select();
  if (error) fail("insertRecords", error);

  return {
    records: (data ?? []).map(
      (r): Record_ => ({
        id: r.id as string,
        data: (r.data as Row) ?? {},
        sortOrder: Number(r.sort_order),
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
        createdBy: (r.created_by as string) ?? null,
        updatedBy: (r.updated_by as string) ?? null,
      })
    ),
    errors: [],
  };
}

/**
 * Merge values into records.
 *
 * The old implementation read each row, merged in JavaScript, and wrote the whole
 * `data` blob back — a read-modify-write, which means two concurrent cell edits
 * on the same row silently lose one. This uses `jsonb ||` server-side, so the
 * merge happens inside the UPDATE and concurrent edits to *different cells* of
 * the same row both survive.
 */
export async function updateRecords(
  tableId: string,
  patches: { id: string; values: Row }[]
): Promise<{ errors: WriteError[]; computed: { id: string; values: Row }[] }> {
  const fields = await listFields(tableId);

  const cleaned: { id: string; values: Row }[] = [];
  const errors: WriteError[] = [];
  patches.forEach((p, i) => {
    const r = sanitizeValues(fields, p.values, i);
    errors.push(...r.errors);
    cleaned.push({ id: p.id, values: r.clean });
  });
  if (errors.length) return { errors, computed: [] };

  const { error } = await db().rpc("swamp_patch_records", {
    p_table_id: tableId,
    p_patches: cleaned,
  });
  if (error) fail("updateRecords", error);

  return { errors: [], computed: await computedValues(tableId, cleaned.map((p) => p.id)) };
}

/**
 * What a write recomputed: the computed fields of these records, as they are NOW.
 *
 * A formula's value lives nowhere on disk — it is produced by the projection in
 * swamp_query_records at read time — so after a write the only way to know it is to
 * ask. This is that ask, scoped to the rows the write touched.
 *
 * It returns COMPUTED KEYS ONLY, and deliberately: echoing scalars back would race
 * the undo stack and the user's own typing. See 20260716050000_computed_after_write.sql.
 *
 * A table with no computed fields gets `[]` without the function touching the heap,
 * so the ordinary grid pays one cheap catalog read for a feature it doesn't use.
 */
export async function computedValues(
  tableId: string,
  ids: string[]
): Promise<{ id: string; values: Row }[]> {
  if (!ids.length) return [];

  const { data, error } = await db().rpc("swamp_computed_values", {
    p_table_id: tableId,
    p_ids: ids,
  });
  if (error) fail("computedValues", error);

  return (data as { id: string; values: Row }[]) ?? [];
}

/** Soft delete. The read path excludes these automatically. */
export async function deleteRecords(tableId: string, ids: string[]): Promise<void> {
  const { error } = await db()
    .from("records")
    .update({ deleted_at: new Date().toISOString() })
    .eq("table_id", tableId)
    .in("id", ids);
  if (error) fail("deleteRecords", error);
}

/**
 * Move a record between two neighbours.
 *
 * Fractional indexing: the new order is the midpoint of its neighbours, so ONE
 * row is written. No renumbering of siblings, no lock contention, no O(n) update.
 * The server computes the midpoint — clients don't get to invent sort_order
 * values, or two racing clients collide and the order becomes non-deterministic.
 */
export async function moveRecord(
  tableId: string,
  id: string,
  beforeId: string | null,
  afterId: string | null
): Promise<number> {
  const { data, error } = await db().rpc("swamp_move_record", {
    p_table_id: tableId,
    p_record_id: id,
    p_before_id: beforeId,
    p_after_id: afterId,
  });
  if (error) fail("moveRecord", error);
  return Number(data);
}
