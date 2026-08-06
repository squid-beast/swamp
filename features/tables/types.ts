// ════════════════════════════════════════════════════════════════════════════
// The domain model. Mirrors supabase/migrations/20260714010000_workspace_schema.
//
//   workspace → base → table → { field, view, record }
//                                view → { viewField, filter, sort }
//                                record ←→ record  (link)
//
// This replaces features/datasets/types.ts, which modelled a flat `Dataset` with
// its fields and views stored as JSONB blobs on the same row.
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

/** The barcode symbologies jsbarcode can draw — the same eleven NocoDB offers
 *  (nocodb-sdk columnHelper/utils/common.ts). CODE128 is the default because it
 *  encodes arbitrary text; the rest have real constraints (EAN13 wants 13 digits)
 *  and jsbarcode refuses a value that doesn't fit, which the cell reports. */
export const BARCODE_FORMATS = [
  "CODE128",
  "CODE39",
  "EAN13",
  "EAN8",
  "EAN5",
  "EAN2",
  "UPC",
  "ITF14",
  "MSI",
  "pharmacode",
  "codabar",
] as const;

/** What a barcode/QR may point at. Scalars only: swamp_field_catalog resolves the
 *  pointer in PASS 1, and formulas are not computed until passes 2-6, so a barcode
 *  pointing at a formula would read an expression that does not exist yet. NocoDB
 *  allows Formula here; we don't, and the catalog enforces the same list. */
export const BARCODE_SOURCE_TYPES = [
  "text",
  "longText",
  "number",
  "phone",
  "email",
  "url",
  "uuid",
  "year",
  "currency",
  "percent",
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
  // Stored in record.data like a scalar, but assigned by the database and never
  // writable — a durable, gap-free sequence. See 20260718000000_auto_number.sql.
  "autoNumber",
  ...AUTO_FIELD_TYPES,
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

const READ_ONLY = new Set<FieldType>([
  ...COMPUTED_FIELD_TYPES,
  ...AUTO_FIELD_TYPES,
  "button",
  "barcode",
  "qr",
  // The database assigns it and freezes it. A client write is dropped on every
  // path (repo.ts, rest.ts, use-grid.ts all gate on isReadOnlyField), and the
  // trigger would ignore it anyway.
  "autoNumber",
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
  // Kept in step with swamp_is_numeric_type: an autoNumber sorts and filters as
  // the integer it is, not as text (where "10" would sort before "9").
  "autoNumber",
]);
const TEMPORAL = new Set<FieldType>(["date", "datetime"]);

export const isNumericField = (t: FieldType) => NUMERIC.has(t);
export const isTemporalField = (t: FieldType) => TEMPORAL.has(t);

// ─── Entities ───────────────────────────────────────────────────────────────

/** The ladder, low to high. `Role` is derived so the two can never disagree. */
export const ROLE_ORDER = ["viewer", "commenter", "editor", "creator", "owner"] as const;

export type Role = (typeof ROLE_ORDER)[number];

// ─── Permissions ────────────────────────────────────────────────────────────
//
// NocoDB's PermissionKey model, minus its read key. All three below are WRITE
// permissions, and writes have a real choke point: every path that changes a
// record reaches records.data through an INSERT/UPDATE on public.records, where
// one trigger catches session, token, form and RPC callers alike.
//
// TABLE_VISIBILITY is deliberately absent — it is a READ permission, and the
// read surface has ~15 paths that bypass the field allow-list. Offering a rule
// that silently fails to hold is worse than not offering it. See
// supabase/migrations/20260806000000_permissions_inert.sql.
export const PERMISSION_KEYS = [
  "table_record_add",
  "table_record_delete",
  "record_field_edit",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Who a rule admits. `nobody` locks it for everyone, owners included. */
export const PERMISSION_GRANTS = ["role", "user", "nobody"] as const;
export type PermissionGrant = (typeof PERMISSION_GRANTS)[number];

export interface Permission {
  id: string;
  baseId: string;
  tableId: string;
  /** Only ever set for `record_field_edit`. */
  fieldId: string | null;
  key: PermissionKey;
  grantedType: PermissionGrant;
  /** The minimum rung, when grantedType is "role". */
  role: Role | null;
  userIds: string[];
}

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  table_record_add: "Add records",
  table_record_delete: "Delete or restore records",
  record_field_edit: "Edit this field",
};

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

  /** longText — render the value as markdown (bold/italic/links/lists/code).
   *  The stored value stays a plain string, so search, export and the JSONB
   *  storage model are untouched; rich is a DISPLAY mode, not a format. */
  rich?: boolean;

  /** user — hold several people rather than one. Matches NocoDB's `meta.is_multi`,
   *  which also defaults to single. Off means the cell stores a bare uuid; on means
   *  an array of them. */
  allowMultiple?: boolean;

  // barcode | qr
  //
  // These hold no value: they POINT at another field and draw its value. Same shape
  // as NocoDB's fk_barcode_value_column_id / fk_qr_value_column_id. The pointer is
  // resolved in SQL by swamp_field_catalog, so the cell just receives the source's
  // value like any other.
  //
  // Sources are restricted to scalars — the catalog resolves this in pass 1, before
  // formulas exist. See 20260716040000_barcode_qr.sql.
  sourceFieldId?: string;
  /** barcode only. One of BARCODE_FORMATS; CODE128 if unset. */
  barcodeFormat?: string;

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

  // autoNumber — presentation only. The stored value is always the bare integer.
  //   prefix  — printed before the number: "LEAD-" → "LEAD-0007".
  //   padding — zero-pad the number to at least this many digits (1043 stays 1043
  //             at padding 4; 7 becomes 0007).
  prefix?: string;
  padding?: number;
}

/** Render an autoNumber's stored integer the way its options ask: an optional
 *  prefix and zero-padding. Pure and side-effect-free so it can be unit-tested
 *  and reused by the grid cell, the expanded record, and the form runtime alike. */
export function formatAutoNumber(
  value: unknown,
  options: Pick<FieldOptions, "prefix" | "padding"> = {}
): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);

  const digits = Math.max(0, Math.min(20, Math.floor(options.padding ?? 0)));
  const body = Math.trunc(Math.abs(n)).toString().padStart(digits, "0");
  const sign = n < 0 ? "-" : "";
  return `${options.prefix ?? ""}${sign}${body}`;
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

/** Every view type. The single source — the create route's z.enum and the
 *  swamp_view_type Postgres enum mirror this list. */
export const VIEW_TYPES = [
  "grid",
  "gallery",
  "kanban",
  "form",
  "calendar",
  "list",
  "timeline",
  "gantt",
  "map",
] as const;

export type ViewType = (typeof VIEW_TYPES)[number];

/**
 * The permission check for editing a view's config is two-dimensional. Model it
 * as a function, not a boolean:
 *
 *   role >= editor  AND  not locked  AND  (not personal OR I own it)
 */
export type ViewLock = "collaborative" | "locked" | "personal";

export interface ViewConfig {
  rowHeight?: "short" | "medium" | "tall" | "extra"; // grid
  /** Colour each row by a single-select/status field's option colour. Grid only. */
  colorFieldId?: string;
  coverFieldId?: string; // gallery | kanban
  stackFieldId?: string; // kanban
  stacks?: { id: string; title: string; order: number; collapsed: boolean }[];
  ranges?: { fromFieldId: string; toFieldId?: string }[]; // calendar | timeline | gantt
  /** map — the coordinates field to place markers by ("lat,lng" text). */
  coordFieldId?: string;
  /** gantt — a self-referential link field whose targets are a bar's
   *  predecessors. Resolved by the catalog like any link; the view just draws
   *  arrows between the rows it already has. */
  dependencyFieldId?: string;
  /** Conditional row colouring: first matching rule wins, evaluated in SQL by
   *  swamp_row_colors (the same compiler as filters — never a JS evaluator).
   *  Takes precedence over colorFieldId. Grid only; NEVER applied on the shared
   *  path — a rule over a hidden field is a blind-oracle leak. Max 5. */
  rowColorRules?: { filter: FilterNode; color: string }[];
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

/** A view's saved configuration, resolved for the client: which fields, which
 *  filters, which sorts. The authoritative shape — do not re-declare it. */
export interface ViewConfigData {
  viewFields: ViewField[];
  filter: FilterNode | null;
  sorts: SortSpec[];
}

// ─── Colour palette ───────────────────────────────────────────────────────────
//
// One palette, named eight ways, in one place. Select/status options store a NAME
// ("amber"); the pill renderer maps the name to Tailwind classes (cell.tsx SWATCH),
// and everything that needs a real colour value — the row-colour stripe, presence
// avatars — maps the name to a hex here. Before this lived in three files with the
// same eight hexes copy-pasted, so a palette change was a three-file change nobody
// remembered to finish.

/** The option colour names, in swatch order. */
export const OPTION_PALETTE = [
  "amber",
  "violet",
  "teal",
  "rose",
  "sky",
  "lime",
  "orange",
  "fuchsia",
  // 10 chips, matching NocoDB's enumColors count. EXTEND ONLY — stored field
  // options reference these names, so renaming or removing one corrupts data.
  "blue",
  "gray",
] as const;

/** Option colour name → hex, for anywhere that needs a real colour value. */
export const PALETTE_HEX: Record<string, string> = {
  amber: "#f59e0b",
  violet: "#8b5cf6",
  teal: "#14b8a6",
  rose: "#f43f5e",
  sky: "#0ea5e9",
  lime: "#84cc16",
  orange: "#f97316",
  fuchsia: "#d946ef",
  blue: "#3b82f6",
  gray: "#6b7280",
};

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

/** The scopes that are actually enforced.
 *
 *  There were five. `schema:read`, `webhooks:read` and `webhooks:write` were read by
 *  NOTHING — every `swamp_api_require` call in platform.sql asks for `records:read`
 *  or `records:write` and there are no other call sites. A `schema:read`-only token
 *  could not even call /api/v1/meta (which requires records:read), so it could do
 *  nothing at all, and there are no v1 webhook endpoints for the webhook scopes to
 *  govern. They were removed rather than enforced: gating /meta behind schema:read
 *  would break every token minted with the default '{records:read}', which is the
 *  modal token. See 20260716010000_token_scopes.sql.
 *
 *  Add one back only in the same commit as the endpoint that honours it. */
export const TOKEN_SCOPES = ["records:read", "records:write"] as const;

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
  /** Tables the token may touch. Empty means every table in the base — the
   *  default, and how every token behaved before per-table pinning existed. A
   *  non-empty list contains a lead-ingest key to exactly the tables it needs. */
  tableIds: string[];
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

/** The shape a webhook's target speaks.
 *
 *   generic — Swamp's own signed JSON envelope. The default; unchanged forever.
 *   slack   — a Slack incoming webhook: { text }.
 *   discord — a Discord incoming webhook: { content }.
 *
 * The dispatcher formats the body per kind (features/tables/webhook-format.ts). */
export const WEBHOOK_KINDS = ["generic", "slack", "discord", "teams", "mattermost", "email"] as const;

export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

export interface Webhook {
  id: string;
  baseId: string;
  /** null = every table in the base. */
  tableId: string | null;
  name: string;
  /** null only for kind 'email', which has no URL — delivery goes through the
   *  app's email sender. Enforced by a DB CHECK. */
  url: string | null;
  secret: string;
  events: WebhookEvent[];
  /** Fire only when one of these fields changed. Empty = any field. */
  fieldIds: string[];
  /** Fire only when the record matches — the same filter tree a view uses. */
  condition: FilterNode | null;
  /** Which body shape to send. Chat kinds get their native shape; generic gets
   *  Swamp's signed envelope; email goes out through Resend. */
  kind: WebhookKind;
  /** Optional {{placeholder}} message for the non-generic kinds. Null = a built
   *  default. */
  template: string | null;
  /** Per-kind settings. email: { to }. Readable by every creator on the base —
   *  never put a paid-API credential here. */
  config: Record<string, unknown>;
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

/** Every filter operator. The single source — schema.ts derives its z.enum from
 *  this, and the SQL compiler (swamp_compile_filter) mirrors it arm for arm. */
export const FILTER_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "btw",
  "nbtw",
  "like",
  "nlike",
  "empty",
  "notempty",
  "anyof",
  "nanyof",
  "allof",
  "nallof",
  "checked",
  "notchecked",
  "isWithin",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

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
  /** Compare against ANOTHER FIELD's value instead of a literal — "Actual >
   *  Forecast". A field KEY, symmetrical with `field`; resolved through the same
   *  catalog map in swamp_compile_filter, so the injection boundary is unchanged.
   *  Comparison operators only; when set, `value` is ignored. */
  valueField?: string;
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
  "percent_unique",
] as const;

export const NUMERIC_AGGREGATIONS = ["sum", "min", "max", "avg", "median", "std_dev", "range"] as const;
export const BOOLEAN_AGGREGATIONS = ["checked", "unchecked", "percent_checked"] as const;
export const DATE_AGGREGATIONS = ["earliest", "latest", "date_range"] as const;

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
const NUMERIC_OPS: FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "btw", "nbtw", "empty", "notempty"];
const TEMPORAL_OPS: FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "btw", "nbtw", "isWithin", "empty", "notempty"];
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
    case "nbtw":
      return "is not between";
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
