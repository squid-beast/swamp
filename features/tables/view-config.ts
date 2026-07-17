import "server-only";
import { createClient } from "@/shared/supabase/server";
import { listFields } from "./repo";
import {
  isFilterGroup,
  type Field,
  type FilterNode,
  type QuerySpec,
  type SortSpec,
  type ViewField,
} from "./types";

// ════════════════════════════════════════════════════════════════════════════
// A view's saved configuration: which fields, which filters, which sorts.
//
// This is the thing the old model didn't have. `ViewConfig.filters` and `.sort`
// were declared in the types and READ BY NOTHING — filters lived in a component's
// useState, evaporated on navigation, and were never shared with anyone. A view
// that doesn't persist its config isn't a view; it's a scroll position.
//
// ── The filter tree ──
//
// `filters` is one self-referencing table: a row is either a GROUP (and/or/not
// with children) or a LEAF (field, op, value). parent_id is what makes nesting
// work, and depth is unbounded in the schema (capped at 10 by the compiler).
//
// The tree is stored by FIELD ID and queried by FIELD KEY. That indirection is
// deliberate: renaming a field must not break a filter, and the key is the only
// thing that never changes.
// ════════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

function db() {
  return createClient();
}

export interface ViewConfigData {
  viewFields: ViewField[];
  filter: FilterNode | null;
  sorts: SortSpec[];
}

// ─── Load ───────────────────────────────────────────────────────────────────

interface FilterRow {
  id: string;
  parent_id: string | null;
  is_group: boolean;
  logical_op: "and" | "or" | "not";
  field_id: string | null;
  op: string | null;
  sub_op: string | null;
  value: unknown;
  sort_order: number;
  enabled: boolean;
}

/** Rebuild the tree from the flat rows. */
function buildTree(rows: FilterRow[], fieldsById: Map<string, Field>): FilterNode | null {
  const children = new Map<string | null, FilterRow[]>();
  for (const r of rows) {
    const list = children.get(r.parent_id) ?? [];
    list.push(r);
    children.set(r.parent_id, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const build = (row: FilterRow): FilterNode | null => {
    if (row.is_group) {
      const kids = (children.get(row.id) ?? [])
        .map(build)
        .filter((n): n is FilterNode => n !== null);
      if (!kids.length) return null;
      return { op: row.logical_op, children: kids };
    }

    // A filter whose field was deleted. Drop it rather than emitting a leaf with
    // no field — the compiler would reject the whole query and the view would be
    // unopenable, which is a worse outcome than a filter quietly going away.
    const field = row.field_id ? fieldsById.get(row.field_id) : undefined;
    if (!field || !row.op) return null;

    return {
      field: field.key,
      op: row.op as FilterNode extends { op: infer O } ? O : never,
      ...(row.value !== null && row.value !== undefined ? { value: row.value } : {}),
      ...(row.sub_op ? { subOp: row.sub_op } : {}),
    } as FilterNode;
  };

  const roots = (children.get(null) ?? [])
    .filter((r) => r.enabled)
    .map(build)
    .filter((n): n is FilterNode => n !== null);

  if (!roots.length) return null;
  if (roots.length === 1) return roots[0];
  return { op: "and", children: roots };
}

export async function loadViewConfig(
  viewId: string,
  tableId: string
): Promise<ViewConfigData> {
  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  const [vf, fl, so] = await Promise.all([
    db().from("view_fields").select("*").eq("view_id", viewId).order("sort_order"),
    db().from("filters").select("*").eq("view_id", viewId).order("sort_order"),
    db().from("sorts").select("*").eq("view_id", viewId).order("sort_order"),
  ]);

  if (vf.error) throw new Error(`loadViewConfig fields: ${vf.error.message}`);
  if (fl.error) throw new Error(`loadViewConfig filters: ${fl.error.message}`);
  if (so.error) throw new Error(`loadViewConfig sorts: ${so.error.message}`);

  const viewFields: ViewField[] = (vf.data ?? []).map((r: Row) => ({
    viewId: r.view_id as string,
    fieldId: r.field_id as string,
    show: !!r.show,
    sortOrder: Number(r.sort_order),
    width: r.width === null ? null : Number(r.width),
    aggregation: (r.aggregation as string) ?? null,
    groupBy: !!r.group_by,
    groupByOrder: r.group_by_order === null ? null : Number(r.group_by_order),
    groupByDir: (r.group_by_dir as "asc" | "desc") ?? null,
    formConfig: (r.form_config as ViewField["formConfig"]) ?? {},
  }));

  const sorts: SortSpec[] = (so.data ?? [])
    .map((r: Row) => {
      const field = fieldsById.get(r.field_id as string);
      return field ? { field: field.key, dir: r.direction as "asc" | "desc" } : null;
    })
    .filter((s): s is SortSpec => s !== null);

  return {
    viewFields,
    filter: buildTree((fl.data ?? []) as unknown as FilterRow[], fieldsById),
    sorts,
  };
}

/**
 * A view's config as a query spec, ready for the compiler.
 *
 * This is the join between "what the user configured" and "what Postgres runs".
 * The old grid had no equivalent, because there was nothing to resolve — the
 * filter lived in React state and was applied to an array.
 */
export async function viewQuerySpec(
  viewId: string,
  tableId: string
): Promise<QuerySpec> {
  const { filter, sorts } = await loadViewConfig(viewId, tableId);
  return {
    ...(filter ? { filter } : {}),
    ...(sorts.length ? { sort: sorts } : {}),
  };
}

// ─── Save ───────────────────────────────────────────────────────────────────

/**
 * Replace a view's whole filter tree.
 *
 * Delete-then-insert rather than a diff. A filter tree is a handful of rows and
 * the diff would be pure complexity — but note this means concurrent editors
 * last-write-wins the ENTIRE tree, not per-condition. That's the right trade for
 * now, and it's the kind of thing that quietly becomes wrong once views are
 * shared, so it's written down rather than assumed.
 */
export async function saveFilterTree(
  viewId: string,
  baseId: string,
  tableId: string,
  node: FilterNode | null
): Promise<void> {
  const fields = await listFields(tableId);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const rows: Row[] = [];

  const walk = (n: FilterNode, parentId: string | null, order: number): void => {
    const id = crypto.randomUUID();

    if (isFilterGroup(n)) {
      rows.push({
        id,
        base_id: baseId,
        view_id: viewId,
        parent_id: parentId,
        is_group: true,
        logical_op: n.op,
        field_id: null,
        op: null,
        sub_op: null,
        value: null,
        sort_order: order,
        enabled: true,
      });
      n.children.forEach((c, i) => walk(c, id, i));
      return;
    }

    const field = byKey.get(n.field);
    if (!field) return; // a key that isn't a field: drop it, don't persist garbage

    rows.push({
      id,
      base_id: baseId,
      view_id: viewId,
      parent_id: parentId,
      is_group: false,
      logical_op: "and",
      field_id: field.id,
      op: n.op,
      sub_op: n.subOp ?? null,
      value: n.value ?? null,
      sort_order: order,
      enabled: true,
    });
  };

  if (node) walk(node, null, 0);

  const del = await db().from("filters").delete().eq("view_id", viewId);
  if (del.error) throw new Error(`saveFilterTree delete: ${del.error.message}`);

  if (rows.length) {
    const ins = await db().from("filters").insert(rows);
    if (ins.error) throw new Error(`saveFilterTree insert: ${ins.error.message}`);
  }
}

export async function saveSorts(
  viewId: string,
  baseId: string,
  tableId: string,
  sorts: SortSpec[]
): Promise<void> {
  const fields = await listFields(tableId);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const del = await db().from("sorts").delete().eq("view_id", viewId);
  if (del.error) throw new Error(`saveSorts delete: ${del.error.message}`);

  const rows = sorts
    .map((s, i) => {
      const field = byKey.get(s.field);
      if (!field) return null;
      return {
        view_id: viewId,
        base_id: baseId,
        field_id: field.id,
        direction: s.dir,
        sort_order: i, // precedence: which sort wins
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length) {
    const ins = await db().from("sorts").insert(rows);
    if (ins.error) throw new Error(`saveSorts insert: ${ins.error.message}`);
  }
}

/**
 * Per-view field settings: visibility, order, width, grouping, aggregation.
 * Upsert, one row per field.
 *
 * ── Why this batches by key signature ──
 *
 * PostgREST turns an array into ONE multi-row INSERT, and the column list is the
 * UNION of the keys across the array. A row that omitted a key another row carried
 * gets an explicit NULL — not the column's default. So a payload mixing
 * `{fieldId, width}` with `{fieldId, sortOrder}` writes NULL into `show` and
 * `group_by`, which are NOT NULL, and the whole batch dies with a 23502. Worse for
 * `aggregation`, which IS nullable: that one silently wipes the column and returns
 * 200.
 *
 * Callers used to be safe only by accident — every one of them happened to send
 * homogeneous rows. The first caller to mix keys would have found this the hard
 * way, and the same union rule already broke a NOT NULL on `fields.is_primary` in
 * a test seed, which is how it was found.
 *
 * Grouping by key signature means each upsert carries exactly one column list, so
 * no row is ever missing a key that another row supplied. It costs one round trip
 * per distinct shape — in practice one — and it means no caller has to know any of
 * the above.
 */
export async function saveViewFields(
  viewId: string,
  baseId: string,
  patches: {
    fieldId: string;
    show?: boolean;
    sortOrder?: number;
    width?: number;
    groupBy?: boolean;
    groupByOrder?: number | null;
    groupByDir?: "asc" | "desc" | null;
    aggregation?: string | null;
    formConfig?: ViewField["formConfig"];
  }[]
): Promise<void> {
  if (!patches.length) return;

  const rowOf = (p: (typeof patches)[number]) => ({
    view_id: viewId,
    field_id: p.fieldId,
    base_id: baseId,
    ...(p.show !== undefined ? { show: p.show } : {}),
    ...(p.sortOrder !== undefined ? { sort_order: p.sortOrder } : {}),
    ...(p.width !== undefined ? { width: p.width } : {}),
    ...(p.groupBy !== undefined ? { group_by: p.groupBy } : {}),
    ...(p.groupByOrder !== undefined ? { group_by_order: p.groupByOrder } : {}),
    ...(p.groupByDir !== undefined ? { group_by_dir: p.groupByDir } : {}),
    ...(p.aggregation !== undefined ? { aggregation: p.aggregation } : {}),
    ...(p.formConfig !== undefined ? { form_config: p.formConfig } : {}),
  });

  const byShape = new Map<string, Record<string, unknown>[]>();
  for (const p of patches) {
    const row = rowOf(p);
    const shape = Object.keys(row).sort().join(",");
    byShape.set(shape, [...(byShape.get(shape) ?? []), row]);
  }

  for (const rows of byShape.values()) {
    const { error } = await db()
      .from("view_fields")
      .upsert(rows, { onConflict: "view_id,field_id" });
    if (error) throw new Error(`saveViewFields: ${error.message}`);
  }
}
