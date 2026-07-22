import "server-only";
import { db } from "@/shared/supabase/server";
import { deriveFieldKey } from "./field-key";
import { listFields } from "./repo";
import { formulaDependencies, parseFormula, type Node } from "./formula/parser";
import type { Field, FieldOptions } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Relational fields: link, lookup, rollup, formula, count.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a link field — and its MIRROR on the other table.
 *
 * ── This is the most bug-prone operation in the whole system ──
 *
 * A link is not a property of one table. "Project has many Tasks" and "Task
 * belongs to Project" are the same edge seen from two ends, and if the two field
 * rows ever disagree — different target, one deleted, one pointing at a table
 * that's gone — the base is quietly corrupt in a way no query will tell you about.
 *
 * So: both rows are created together, they reference each other by id, and
 * deleting either deletes both. There is no code path that makes one without the
 * other. The reference implementation got this wrong repeatedly and patched it
 * repeatedly; the fix is to make the asymmetric state unrepresentable.
 *
 * Note also that BOTH fields point at the SAME `links` rows. The edge is stored
 * once. `field_id` on a link row is the field on the FROM side, so reading the
 * mirror means querying by `to_record_id` instead of `from_record_id` — which is
 * what makes cardinality a read shape rather than a storage layout.
 */
export async function createLinkField(
  tableId: string,
  baseId: string,
  input: {
    name: string;
    targetTableId: string;
    cardinality: "one" | "many";
    /** What the mirror is called on the other table. Defaults to this table's name. */
    symmetricName?: string;
  }
): Promise<Field> {
  const [ownFields, targetFields, { data: ownTable }] = await Promise.all([
    listFields(tableId),
    listFields(input.targetTableId),
    db().from("tables").select("name").eq("id", tableId).single(),
  ]);

  const ownKey = deriveFieldKey(input.name, new Set(ownFields.map((f) => f.key)));
  const mirrorName = input.symmetricName ?? (ownTable?.name as string) ?? "Linked";
  const mirrorKey = deriveFieldKey(mirrorName, new Set(targetFields.map((f) => f.key)));

  // Insert both, then wire them to each other. Two statements rather than one,
  // because each needs the other's id — but they go in together, so a failure
  // leaves neither.
  const { data: created, error } = await db()
    .from("fields")
    .insert([
      {
        table_id: tableId,
        base_id: baseId,
        name: input.name,
        key: ownKey,
        type: "link",
        options: { targetTableId: input.targetTableId, cardinality: input.cardinality },
        is_primary: false,
        sort_order: ownFields.length + 1,
      },
      {
        table_id: input.targetTableId,
        base_id: baseId,
        name: mirrorName,
        key: mirrorKey,
        type: "link",
        options: { targetTableId: tableId, cardinality: "many" },
        is_primary: false,
        sort_order: targetFields.length + 1,
      },
    ])
    .select();

  if (error) throw new Error(`createLinkField: ${error.message}`);

  const own = created.find((f) => f.table_id === tableId)!;
  const mirror = created.find((f) => f.id !== own.id)!;

  await Promise.all([
    db()
      .from("fields")
      .update({ options: { ...own.options, symmetricFieldId: mirror.id } })
      .eq("id", own.id),
    db()
      .from("fields")
      .update({ options: { ...mirror.options, symmetricFieldId: own.id } })
      .eq("id", mirror.id),
  ]);

  return {
    id: own.id,
    tableId,
    baseId,
    name: input.name,
    key: ownKey,
    type: "link",
    options: {
      targetTableId: input.targetTableId,
      cardinality: input.cardinality,
      symmetricFieldId: mirror.id,
    },
    isPrimary: false,
    sortOrder: Number(own.sort_order),
  };
}

/** Delete a link and its mirror together. Neither may outlive the other. */
export async function deleteLinkField(fieldId: string): Promise<void> {
  const { data: field } = await db()
    .from("fields")
    .select("options")
    .eq("id", fieldId)
    .maybeSingle();

  const mirrorId = (field?.options as FieldOptions | undefined)?.symmetricFieldId;
  const ids = mirrorId ? [fieldId, mirrorId] : [fieldId];

  const { error } = await db()
    .from("fields")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);

  if (error) throw new Error(`deleteLinkField: ${error.message}`);
}

// ─── Link edges ─────────────────────────────────────────────────────────────

/**
 * Set the records a link cell points at. Replaces whatever was there.
 *
 * `one` cardinality is enforced HERE rather than by a database constraint,
 * deliberately: it's a product rule, not an integrity rule, and someone will want
 * to change a one-link to a many-link later without a migration. Truncating is
 * the friendly behaviour — picking two things in a one-link should keep the last
 * one, not error.
 */
export async function setLinks(
  fieldId: string,
  baseId: string,
  fromRecordId: string,
  toRecordIds: string[]
): Promise<void> {
  const { data: field } = await db()
    .from("fields")
    .select("options")
    .eq("id", fieldId)
    .single();

  const options = (field?.options ?? {}) as FieldOptions;
  const ids =
    options.cardinality === "one" ? toRecordIds.slice(-1) : toRecordIds;

  const del = await db()
    .from("links")
    .delete()
    .eq("field_id", fieldId)
    .eq("from_record_id", fromRecordId);
  if (del.error) throw new Error(`setLinks clear: ${del.error.message}`);

  if (!ids.length) return;

  const ins = await db().from("links").insert(
    ids.map((toId, i) => ({
      base_id: baseId,
      field_id: fieldId,
      from_record_id: fromRecordId,
      to_record_id: toId,
      sort_order: i + 1,
    }))
  );
  if (ins.error) throw new Error(`setLinks insert: ${ins.error.message}`);
}

// ─── Lookup / rollup / count ────────────────────────────────────────────────

export async function createComputedField(
  tableId: string,
  baseId: string,
  input: {
    name: string;
    type: "lookup" | "rollup" | "count";
    linkFieldId: string;
    targetFieldId?: string;
    fn?: "count" | "sum" | "avg" | "min" | "max";
  }
): Promise<Field> {
  const existing = await listFields(tableId);

  const options: FieldOptions = {
    linkFieldId: input.linkFieldId,
    ...(input.targetFieldId ? { targetFieldId: input.targetFieldId } : {}),
    ...(input.fn ? { fn: input.fn } : {}),
  };

  const { data, error } = await db()
    .from("fields")
    .insert({
      table_id: tableId,
      base_id: baseId,
      name: input.name,
      key: deriveFieldKey(input.name, new Set(existing.map((f) => f.key))),
      type: input.type,
      options,
      is_primary: false,
      sort_order: existing.length + 1,
    })
    .select()
    .single();

  if (error) throw new Error(`createComputedField: ${error.message}`);

  return {
    id: data.id,
    tableId,
    baseId,
    name: data.name,
    key: data.key,
    type: data.type,
    options,
    isPrimary: false,
    sortOrder: Number(data.sort_order),
  };
}

// ─── Formula ────────────────────────────────────────────────────────────────

export interface FormulaInput {
  name: string;
  /** What the user typed, with field names in {braces}. */
  expr: string;
}

/**
 * Parse a formula and store it as an AST keyed by field ID.
 *
 * Three things are stored:
 *   ast     — the truth. Field references are IDs.
 *   exprRaw — what the user typed. Display only, and regenerated on rename.
 *
 * A cycle check runs BEFORE the write. The SQL compiler has a depth cap so a cycle
 * can't hang the database — but catching it here means the user gets "that would
 * be circular" while they're typing, instead of a formula that saves fine and then
 * silently renders blank forever.
 */
export async function createFormulaField(
  tableId: string,
  baseId: string,
  input: FormulaInput,
  fieldId?: string // set when EDITING an existing formula
): Promise<Field> {
  const fields = await listFields(tableId);

  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.id]));
  const ast = parseFormula(input.expr, { fieldsByName: byName });

  await assertNoCycle(fields, ast, fieldId);

  const options: FieldOptions = {
    ast: ast as unknown as FieldOptions["ast"],
    exprRaw: input.expr,
  };

  if (fieldId) {
    const { error } = await db()
      .from("fields")
      .update({ name: input.name, options })
      .eq("id", fieldId);
    if (error) throw new Error(`updateFormula: ${error.message}`);

    const existing = fields.find((f) => f.id === fieldId)!;
    return { ...existing, name: input.name, options };
  }

  const { data, error } = await db()
    .from("fields")
    .insert({
      table_id: tableId,
      base_id: baseId,
      name: input.name,
      key: deriveFieldKey(input.name, new Set(fields.map((f) => f.key))),
      type: "formula",
      options,
      is_primary: false,
      sort_order: fields.length + 1,
    })
    .select()
    .single();

  if (error) throw new Error(`createFormulaField: ${error.message}`);

  return {
    id: data.id,
    tableId,
    baseId,
    name: data.name,
    key: data.key,
    type: "formula",
    options,
    isPrimary: false,
    sortOrder: Number(data.sort_order),
  };
}

/**
 * Would this formula depend on itself, directly or through other formulas?
 *
 * Walks the dependency graph. `A = B + 1` and `B = A + 1` is the obvious case; the
 * one that catches people is a chain three or four fields long that closes.
 */
async function assertNoCycle(
  fields: Field[],
  ast: Node,
  selfId?: string
): Promise<void> {
  const formulas = new Map(
    fields
      .filter((f) => f.type === "formula" && f.options.ast)
      .map((f) => [f.id, f.options.ast as unknown as Node])
  );

  const seen = new Set<string>();
  const stack: string[] = [...formulaDependencies(ast)];

  while (stack.length) {
    const id = stack.pop()!;

    if (id === selfId) {
      throw new Error("That formula would reference itself.");
    }
    if (seen.has(id)) continue;
    seen.add(id);

    const nested = formulas.get(id);
    if (nested) stack.push(...formulaDependencies(nested));
  }
}
