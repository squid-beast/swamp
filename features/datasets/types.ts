// ── Core domain types. The UI renders ONLY from these. It never sees source schemas. ──

export type FieldType =
  | "text"
  | "longText"
  | "number"
  | "currency"
  | "percent"
  | "rating"
  | "boolean"
  | "date"
  | "datetime"
  | "time"
  | "duration"
  | "year"
  | "email"
  | "phone"
  | "url"
  | "image"
  | "color"
  | "uuid"
  | "coordinates"
  | "singleSelect"
  | "multiSelect"
  | "status"
  | "json";

export interface SelectOption {
  value: string;
  color: string; // palette key
}

export interface FieldMeta {
  id: string;            // stable key into row objects
  sourceName: string;    // original column name
  displayName: string;
  type: FieldType;
  nullable: boolean;
  unique: boolean;
  options?: SelectOption[]; // for select/status
  currency?: string;        // e.g. "USD"
  sortable: boolean;
  filterable: boolean;
  groupable: boolean;
  searchable: boolean;
  hidden: boolean;
  width?: number;
  confidence: number; // 0-1 from inference
}

// User customizations layered over inference. Never clobbered by re-import.
export type FieldOverride = Partial<
  Pick<FieldMeta, "displayName" | "type" | "hidden" | "width" | "options">
>;

export type ViewType = "grid" | "kanban" | "gallery" | "dashboard";

export interface ViewConfig {
  id: string;
  type: ViewType;
  name: string;
  sort?: { fieldId: string; dir: "asc" | "desc" };
  groupBy?: string;      // fieldId (kanban lanes / grid groups)
  imageField?: string;   // gallery
  titleField?: string;   // gallery/kanban cards
  hiddenFields?: string[];
  filters?: { fieldId: string; op: "eq" | "contains" | "gt" | "lt"; value: string }[];
}

export type Row = Record<string, unknown> & { __id: string };

// A cell-level edit: merge `values` into the row with matching __id.
export interface RowPatch {
  __id: string;
  values: Record<string, unknown>;
}

export interface Dataset {
  id: string;
  name: string;
  source: { kind: "csv" | "json" | "xlsx" | "webhook" | "sheet"; ref?: string };
  createdAt: string;
  updatedAt: string;
  fields: FieldMeta[];          // inferred layer
  overrides: Record<string, FieldOverride>; // user layer, keyed by field id
  views: ViewConfig[];
  rowCount: number;
}

export interface DatasetSummary {
  id: string;
  name: string;
  source: Dataset["source"];
  rowCount: number;
  fieldCount: number;
  updatedAt: string;
  recommendedViews: ViewType[];
}

// Merge inference + overrides. This is the ONLY field shape the renderer receives.
export function resolveFields(ds: Dataset): FieldMeta[] {
  return ds.fields.map((f) => ({ ...f, ...(ds.overrides[f.id] ?? {}) }));
}

// ── Money metrics the agent pushes via /api/agent/metrics ("Money (AI)" dataset).
//    Rendered in the header balance badge and the Overview money card.
//    All amounts are USD dollars. ──
export interface Money {
  balance: number | null; // Stripe balance (available + pending)
  revenueMtd: number | null; // collected this calendar month
  pipelineValue: number | null; // est. value of active pipeline
  pipelineCounts: string | null; // e.g. "New 12 · Contacted 5 · Replied 2"
  topAction: string | null; // today's #1 money move
  updatedAt: string | null; // ISO timestamp of last agent push
}
