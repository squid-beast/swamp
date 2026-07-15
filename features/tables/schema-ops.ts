import "server-only";
import { createClient } from "@/shared/supabase/server";
import { deriveFieldKey } from "./field-key";
import { listFields } from "./repo";
import type { Field, FieldOptions, FieldType, View, ViewType } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Schema operations: create / alter / drop fields and views.
//
// None of this existed. Inference guessed a column's type on import and that was
// FINAL — a phone number read as a number (leading zeros gone), a status column
// read as free text, and there was no way to fix either. You could rename a field
// and hide it. That was the entire schema surface.
//
// ── Who may do this ──
//
// Fields and tables are gated at CREATOR in RLS; views and view config at EDITOR.
// That's the load-bearing line in the permission model: editors change data and
// views, creators change schema. It's enforced in the database, so nothing here
// needs to check it — a call from an editor simply fails.
// ════════════════════════════════════════════════════════════════════════════

function db() {
  return createClient();
}

// ─── Fields ─────────────────────────────────────────────────────────────────

export async function createField(
  tableId: string,
  baseId: string,
  input: { name: string; type: FieldType; options?: FieldOptions }
): Promise<Field> {
  const existing = await listFields(tableId);
  const taken = new Set(existing.map((f) => f.key));

  const { data, error } = await db()
    .from("fields")
    .insert({
      table_id: tableId,
      base_id: baseId,
      name: input.name,
      key: deriveFieldKey(input.name, taken),
      type: input.type,
      options: input.options ?? {},
      is_primary: existing.length === 0, // the first field is the display value
      sort_order: existing.length + 1,
    })
    .select()
    .single();

  if (error) throw new Error(`createField: ${error.message}`);

  return {
    id: data.id,
    tableId: data.table_id,
    baseId: data.base_id,
    name: data.name,
    key: data.key,
    type: data.type,
    options: data.options ?? {},
    isPrimary: data.is_primary,
    sortOrder: Number(data.sort_order),
  };
}

/**
 * Alter a field.
 *
 * Note what is NOT updatable: `key`. Renaming a field changes `name` and nothing
 * else. The key is what lives in every record's `data`, and rewriting a million
 * JSONB payloads because someone fixed a typo in a column header would be absurd.
 *
 * Retyping IS allowed and does not touch the stored values — a `text` column
 * holding "1000" becomes a `currency` column holding "1000", and the query engine
 * coerces at read time (safely: "N/A" becomes null rather than throwing). The data
 * is unchanged; only its interpretation is.
 */
export async function updateField(
  fieldId: string,
  patch: {
    name?: string;
    type?: FieldType;
    options?: FieldOptions;
    isPrimary?: boolean;
    sortOrder?: number;
  }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.type !== undefined) row.type = patch.type;
  if (patch.options !== undefined) row.options = patch.options;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;

  // Exactly one primary field per table, enforced by a unique index. Clearing the
  // old one first means the index never sees two — otherwise the update fails and
  // the user is told, unhelpfully, that a constraint was violated.
  if (patch.isPrimary) {
    const { data: field } = await db()
      .from("fields")
      .select("table_id")
      .eq("id", fieldId)
      .single();

    if (field) {
      await db()
        .from("fields")
        .update({ is_primary: false })
        .eq("table_id", field.table_id)
        .eq("is_primary", true);
    }
    row.is_primary = true;
  }

  if (!Object.keys(row).length) return;

  const { error } = await db().from("fields").update(row).eq("id", fieldId);
  if (error) throw new Error(`updateField: ${error.message}`);
}

/**
 * Soft-delete a field.
 *
 * The values stay in `record.data` — they're just no longer described by anything,
 * so nothing reads them. That means an accidental delete is recoverable by
 * un-deleting the field, which is a much better story than "your column is gone".
 */
export async function deleteField(fieldId: string): Promise<void> {
  const { error } = await db()
    .from("fields")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fieldId);
  if (error) throw new Error(`deleteField: ${error.message}`);
}

export async function reorderFields(order: { id: string; sortOrder: number }[]): Promise<void> {
  for (const f of order) {
    const { error } = await db()
      .from("fields")
      .update({ sort_order: f.sortOrder })
      .eq("id", f.id);
    if (error) throw new Error(`reorderFields: ${error.message}`);
  }
}

// ─── Views ──────────────────────────────────────────────────────────────────

const toView = (r: Record<string, unknown>): View => ({
  id: r.id as string,
  tableId: r.table_id as string,
  baseId: r.base_id as string,
  type: r.type as ViewType,
  name: r.name as string,
  isDefault: !!r.is_default,
  lockType: r.lock_type as View["lockType"],
  ownerId: (r.owner_id as string) ?? null,
  config: (r.config as View["config"]) ?? {},
  sortOrder: Number(r.sort_order),
});

export async function createView(
  tableId: string,
  baseId: string,
  input: { name: string; type: ViewType; config?: View["config"] }
): Promise<View> {
  const { count } = await db()
    .from("views")
    .select("*", { count: "exact", head: true })
    .eq("table_id", tableId)
    .is("deleted_at", null);

  const { data, error } = await db()
    .from("views")
    .insert({
      table_id: tableId,
      base_id: baseId,
      type: input.type,
      name: input.name,
      config: input.config ?? {},
      // is_default is NOT set here. There is exactly one default view per table,
      // created with the table, and it cannot be deleted. A second "default" would
      // trip the unique index.
      sort_order: (count ?? 0) + 1,
    })
    .select()
    .single();

  if (error) throw new Error(`createView: ${error.message}`);
  return toView(data);
}

export async function updateView(
  viewId: string,
  patch: { name?: string; config?: View["config"]; lockType?: View["lockType"] }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.config !== undefined) row.config = patch.config;
  if (patch.lockType !== undefined) row.lock_type = patch.lockType;
  if (!Object.keys(row).length) return;

  const { error } = await db().from("views").update(row).eq("id", viewId);
  if (error) throw new Error(`updateView: ${error.message}`);
}

/** Delete a view. The default view cannot be deleted — a table must always have
 *  somewhere to look at it. */
export async function deleteView(viewId: string): Promise<void> {
  const { data: view } = await db()
    .from("views")
    .select("is_default")
    .eq("id", viewId)
    .maybeSingle();

  if (view?.is_default) {
    throw new Error("The default view cannot be deleted.");
  }

  const { error } = await db()
    .from("views")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", viewId);
  if (error) throw new Error(`deleteView: ${error.message}`);
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export async function createTable(
  baseId: string,
  name: string
): Promise<{ tableId: string; viewId: string }> {
  const { data: table, error } = await db()
    .from("tables")
    .insert({ base_id: baseId, name })
    .select("id")
    .single();
  if (error) throw new Error(`createTable: ${error.message}`);

  const { data: view, error: viewError } = await db()
    .from("views")
    .insert({
      table_id: table.id,
      base_id: baseId,
      type: "grid",
      name: "Grid",
      is_default: true,
    })
    .select("id")
    .single();
  if (viewError) throw new Error(`createTable view: ${viewError.message}`);

  return { tableId: table.id, viewId: view.id };
}

export async function updateTable(tableId: string, patch: { name?: string }): Promise<void> {
  if (!patch.name) return;
  const { error } = await db().from("tables").update({ name: patch.name }).eq("id", tableId);
  if (error) throw new Error(`updateTable: ${error.message}`);
}

export async function deleteTable(tableId: string): Promise<void> {
  const { error } = await db()
    .from("tables")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", tableId);
  if (error) throw new Error(`deleteTable: ${error.message}`);
}
