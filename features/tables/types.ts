// ════════════════════════════════════════════════════════════════════════════
// The domain model. Mirrors supabase/migrations/20260714010000_workspace_schema.
//
//   workspace → base → table → { field, view, record }
//                                view → { viewField, filter, sort }
//                                record ←→ record  (link)
//
// This replaces features/datasets/types.ts, which modelled a flat `Dataset` with
// its fields and views stored as JSONB blobs on the same row. See docs/SPEC.md.
// ════════════════════════════════════════════════════════════════════════════

// ─── Field types ────────────────────────────────────────────────────────────

/** Scalars. These are the 23 the inference engine already produces. */
export const SCALAR_FIELD_TYPES = [
  "text",
  "longText",
  "number",
  "currency",
  "percent",
  "rating",
  "boolean",
  "date",
  "datetime",
  "time",
  "duration",
  "year",
  "email",
  "phone",
  "url",
  "image",
  "color",
  "uuid",
  "coordinates",
  "singleSelect",
  "multiSelect",
  "status",
  "json",
] as const;

/** Relational and computed. These have NO value in `record.data` — they are
 *  resolved at query time from `links` or compiled into the SELECT. */
export const COMPUTED_FIELD_TYPES = [
  "link",
  "lookup",
  "rollup",
  "formula",
  "count",
] as const;

/** Auto-maintained by the database. Never accept a write. */
export const AUTO_FIELD_TYPES = [
  "createdTime",
  "modifiedTime",
  "createdBy",
  "modifiedBy",
] as const;

export const FIELD_TYPES = [
  ...SCALAR_FIELD_TYPES,
  "attachment",
  "user",
  ...COMPUTED_FIELD_TYPES,
  "button",
  "barcode",
  "qr",
  ...AUTO_FIELD_TYPES,
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

const READ_ONLY = new Set<FieldType>([
  ...COMPUTED_FIELD_TYPES,
  ...AUTO_FIELD_TYPES,
  "button",
  "barcode",
  "qr",
]);

/** A field whose value the user may never write directly. */
export function isReadOnlyField(type: FieldType): boolean {
  return READ_ONLY.has(type);
}

/** A field with no entry in `record.data` — resolved at query time. */
export function isComputedField(type: FieldType): boolean {
  return (COMPUTED_FIELD_TYPES as readonly string[]).includes(type);
}

const NUMERIC = new Set<FieldType>([
  "number",
  "currency",
  "percent",
  "rating",
  "year",
  "duration",
]);
const TEMPORAL = new Set<FieldType>(["date", "datetime"]);

export const isNumericField = (t: FieldType) => NUMERIC.has(t);
export const isTemporalField = (t: FieldType) => TEMPORAL.has(t);

// ─── Entities ───────────────────────────────────────────────────────────────

export type Role = "viewer" | "commenter" | "editor" | "creator" | "owner";

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  creator: 4,
  owner: 5,
};

/**
 * The load-bearing line in the whole permission model is editor → creator:
 * editors change DATA and VIEWS, creators change SCHEMA.
 */
export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  return role ? ROLE_RANK[role] >= ROLE_RANK[min] : false;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface Base {
  id: string;
  workspaceId: string;
  name: string;
  icon: string | null;
  color: string | null;
  sortOrder: number;
}

export interface Table {
  id: string;
  baseId: string;
  name: string;
  icon: string | null;
  sortOrder: number;
}

export interface SelectOption {
  value: string;
  color: string;
}

/** Per-type config. Only the keys relevant to the field's type are populated. */
export interface FieldOptions {
  options?: SelectOption[]; // singleSelect | multiSelect | status
  currency?: string; // currency
  precision?: number; // currency | number | percent
  max?: number; // rating

  // link
  targetTableId?: string;
  cardinality?: "one" | "many";
  symmetricFieldId?: string;

  // lookup / rollup
  linkFieldId?: string;
  targetFieldId?: string;
  fn?: "count" | "sum" | "avg" | "min" | "max";

  // formula
  //
  // `ast` is the truth: a tree whose field references are field IDs, never names.
  // That is what makes a rename free — no formula ever knew the old name.
  //
  // `exprRaw` is what the user typed. Display only, and regenerated from the AST
  // (with current names) whenever the editor opens.
  ast?: unknown;
  exprRaw?: string;
  error?: string;

  // button
  //
  //   url     — `ast` compiles to the href, per record. It is a formula, and the
  //             query engine treats it as one.
  //   webhook — pressing it POSTs to `webhookId`, server-side. The browser never
  //             sees the target URL, and never holds the secret.
  action?: "url" | "webhook";
  label?: string;
  webhookId?: string;
}

export interface Field {
  id: string;
  tableId: string;
  baseId: string;

  /**
   * Two names, and conflating them is the bug that eats a week.
   *
   *   name — what the user sees. Renameable at will.
   *   key  — the key into `record.data`. NEVER changes.
   *
   * Nothing downstream — no formula, no filter, no view config — may reference a
   * field by its display name. Users rename columns constantly.
   */
  name: string;
  key: string;

  type: FieldType;
  options: FieldOptions;

  /** The display value: what other tables show when they reference this record. */
  isPrimary: boolean;
  sortOrder: number;
}

export type ViewType = "grid" | "gallery" | "kanban" | "form" | "calendar";

/**
 * The permission check for editing a view's config is two-dimensional. Model it
 * as a function, not a boolean:
 *
 *   role >= editor  AND  not locked  AND  (not personal OR I own it)
 */
export type ViewLock = "collaborative" | "locked" | "personal";

export interface ViewConfig {
  rowHeight?: "short" | "medium" | "tall" | "extra"; // grid
  coverFieldId?: string; // gallery | kanban
  stackFieldId?: string; // kanban
  stacks?: { id: string; title: string; order: number; collapsed: boolean }[];
  ranges?: { fromFieldId: string; toFieldId?: string }[]; // calendar
  heading?: string; // form
  successMsg?: string;
}

export interface View {
  id: string;
  tableId: string;
  baseId: string;
  type: ViewType;
  name: string;
  isDefault: boolean;
  lockType: ViewLock;
  ownerId: string | null;
  config: ViewConfig;
  sortOrder: number;
}

export interface ViewField {
  viewId: string;
  fieldId: string;
  show: boolean;
  sortOrder: number;
  width: number | null;
  aggregation: string | null;
  groupBy: boolean;
  groupByOrder: number | null;
  groupByDir: "asc" | "desc" | null;
  /** Form view only: label, help, required, conditional visibility, limited options. */
  formConfig: FormFieldConfig;
}

export interface FormFieldConfig {
  label?: string;
  help?: string;
  required?: boolean;
  /** Show this field only when another answer matches. */
  visibleWhen?: { fieldId: string; equals: string };
  /** Offer a subset of the field's real options. */
  limitedOptions?: string[];
}

export function canEditViewConfig(
  role: Role | null | undefined,
  view: Pick<View, "lockType" | "ownerId">,
  userId: string | null
): boolean {
  if (!roleAtLeast(role, "editor")) return false;
  if (view.lockType === "locked") return false;
  if (view.lockType === "personal") return !!userId && view.ownerId === userId;
  return true;
}

// ─── Platform ───────────────────────────────────────────────────────────────

/**
 * An attachment, as it is stored in `record.data`.
 *
 * Note what is NOT here: a URL. The file is private; the URL is signed at read
 * time and expires. Storing one would be a permanent public link to a private
 * file, and it would outlive every permission change made afterwards.
 */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** `<baseId>/<tableId>/<uuid>-<name>` — the base prefix is what the storage
   *  policy reads to decide who may touch the object. */
  path: string;
  /** Signed, short-lived, added on the way out. Never persisted. */
  url?: string;
}

export const TOKEN_SCOPES = [
  "records:read",
  "records:write",
  "schema:read",
  "webhooks:read",
  "webhooks:write",
] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];

/**
 * A token is not a second identity — it is a narrower view of one that already
 * exists. Its effective role is recomputed from live membership on every call,
 * so a scope can only ever narrow what its owner may do, never widen it.
 */
export interface ApiToken {
  id: string;
  baseId: string;
  userId: string;
  name: string;
  /** The first few characters. The rest exists nowhere after it is minted. */
  prefix: string;
  scopes: TokenScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const WEBHOOK_EVENTS = [
  "record.created",
  "record.updated",
  "record.deleted",
  "comment.created",
  "button.clicked",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  baseId: string;
  /** null = every table in the base. */
  tableId: string | null;
  name: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  /** Fire only when one of these fields changed. Empty = any field. */
  fieldIds: string[];
  /** Fire only when the record matches — the same filter tree a view uses. */
  condition: FilterNode | null;
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: globalThis.Record<string, unknown>;
  status: "pending" | "success" | "failed" | "dead";
  attempts: number;
  nextAttemptAt: string;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Records ────────────────────────────────────────────────────────────────

/**
 * `data` is keyed by `field.key`, never by field name or id.
 *
 * Storage conventions (see the query-engine migration):
 *   multiSelect → a JSON array:  { fld_tags: ["a", "b"] }
 *   everything else → a scalar.
 */
export interface Record_ {
  id: string;
  data: globalThis.Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

// ─── Query spec ─────────────────────────────────────────────────────────────
//
// This is the wire format the client sends. The DATABASE compiles it to SQL —
// the client never sends SQL. See swamp_query_records.

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "btw"
  | "like"
  | "nlike"
  | "empty"
  | "notempty"
  | "anyof"
  | "nanyof"
  | "allof"
  | "nallof"
  | "checked"
  | "notchecked"
  | "isWithin";

/**
 * The date sub-operator. This is what makes "due in the next 7 days" a STORED,
 * RELATIVE filter re-evaluated on every query rather than a literal frozen at
 * save time. It's the single feature that makes filters feel alive.
 */
export type DateSubOp =
  | "today"
  | "tomorrow"
  | "yesterday"
  | "oneWeekAgo"
  | "oneWeekFromNow"
  | "oneMonthAgo"
  | "oneMonthFromNow"
  | "daysAgo"
  | "daysFromNow"
  | "exactDate"
  | "pastWeek"
  | "pastMonth"
  | "pastYear"
  | "nextWeek"
  | "nextMonth"
  | "nextYear"
  | "pastNumberOfDays"
  | "nextNumberOfDays";

export interface FilterLeaf {
  field: string; // field.key
  op: FilterOp;
  value?: unknown;
  subOp?: DateSubOp;
  n?: number;
}

export interface FilterGroup {
  op: "and" | "or" | "not";
  children: FilterNode[];
}

export type FilterNode = FilterLeaf | FilterGroup;

export const isFilterGroup = (n: FilterNode): n is FilterGroup =>
  "children" in n;

export interface SortSpec {
  field: string; // field.key
  dir: "asc" | "desc";
}

/** Opaque. Comes from the previous page's `next`; hand it back untouched. */
export interface Cursor {
  keys: unknown[];
  sortOrder: string;
  id: string;
}

export interface QuerySpec {
  filter?: FilterNode;
  sort?: SortSpec[];
  search?: string;
  limit?: number; // capped at 500 server-side
  cursor?: Cursor | null;
}

export interface QueryResult {
  records: Record_[];
  next: Cursor | null;
}

// ─── Aggregations ───────────────────────────────────────────────────────────

export const COMMON_AGGREGATIONS = [
  "count",
  "count_empty",
  "count_filled",
  "count_unique",
  "percent_empty",
  "percent_filled",
] as const;

export const NUMERIC_AGGREGATIONS = ["sum", "min", "max", "avg", "median"] as const;
export const BOOLEAN_AGGREGATIONS = ["checked", "unchecked", "percent_checked"] as const;
export const DATE_AGGREGATIONS = ["earliest", "latest"] as const;

/** Which summaries a column footer may offer, given the field's type. */
export function aggregationsFor(type: FieldType): readonly string[] {
  if (isNumericField(type)) return [...COMMON_AGGREGATIONS, ...NUMERIC_AGGREGATIONS];
  if (isTemporalField(type)) return [...COMMON_AGGREGATIONS, ...DATE_AGGREGATIONS];
  if (type === "boolean") return [...COMMON_AGGREGATIONS, ...BOOLEAN_AGGREGATIONS];
  return COMMON_AGGREGATIONS;
}

// ─── Operator availability ──────────────────────────────────────────────────
//
// Operators are gated per field type, and their LABELS are contextual: `>` on a
// number is "is after" on a date. Offering `checked` on a text field, or `>` on a
// checkbox, is how a filter builder ends up feeling like a debug tool.

const TEXTUAL_OPS: FilterOp[] = ["eq", "neq", "like", "nlike", "empty", "notempty"];
const NUMERIC_OPS: FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "btw", "empty", "notempty"];
const TEMPORAL_OPS: FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "isWithin", "empty", "notempty"];
const SELECT_OPS: FilterOp[] = ["eq", "neq", "anyof", "nanyof", "empty", "notempty"];
const MULTI_OPS: FilterOp[] = ["anyof", "nanyof", "allof", "nallof", "empty", "notempty"];
const BOOL_OPS: FilterOp[] = ["checked", "notchecked"];

export function operatorsFor(type: FieldType): FilterOp[] {
  if (isNumericField(type)) return NUMERIC_OPS;
  if (isTemporalField(type)) return TEMPORAL_OPS;
  if (type === "boolean") return BOOL_OPS;
  if (type === "multiSelect") return MULTI_OPS;
  if (type === "singleSelect" || type === "status") return SELECT_OPS;
  return TEXTUAL_OPS;
}

export function operatorLabel(op: FilterOp, type: FieldType): string {
  const temporal = isTemporalField(type);
  switch (op) {
    case "eq":
      return temporal ? "is" : "is";
    case "neq":
      return "is not";
    case "gt":
      return temporal ? "is after" : ">";
    case "gte":
      return temporal ? "is on or after" : "≥";
    case "lt":
      return temporal ? "is before" : "<";
    case "lte":
      return temporal ? "is on or before" : "≤";
    case "btw":
      return "is between";
    case "like":
      return type === "attachment" ? "filenames contain" : "contains";
    case "nlike":
      return type === "attachment" ? "filenames don't contain" : "does not contain";
    case "empty":
      return "is empty";
    case "notempty":
      return "is not empty";
    case "anyof":
      return "is any of";
    case "nanyof":
      return "is none of";
    case "allof":
      return "has all of";
    case "nallof":
      return "does not have all of";
    case "checked":
      return "is checked";
    case "notchecked":
      return "is unchecked";
    case "isWithin":
      return "is within";
  }
}
