import { z } from "zod";
import { BARCODE_FORMATS, FIELD_TYPES, TOKEN_SCOPES, WEBHOOK_EVENTS } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Wire schemas. Everything a client can send, validated before it reaches the
// database.
//
// The query engine already refuses unknown field keys and unknown operators —
// that's its injection boundary and it does not depend on this file. But an
// error from deep inside a plpgsql function is a bad error: it arrives as a 500
// with a database message in it. Validating here turns the same mistake into a
// 400 that says which key was wrong.
//
// Defence in depth, and better errors. Not a substitute for the boundary.
// ════════════════════════════════════════════════════════════════════════════

export const fieldTypeSchema = z.enum(FIELD_TYPES);

export const selectOptionSchema = z.object({
  value: z.string(),
  color: z.string(),
});

export const fieldOptionsSchema = z
  .object({
    options: z.array(selectOptionSchema),
    currency: z.string(),
    precision: z.number().int().min(0).max(8),
    max: z.number().int().min(1).max(10),

    // user
    allowMultiple: z.boolean(),

    // barcode | qr
    sourceFieldId: z.string().uuid(),
    barcodeFormat: z.enum(BARCODE_FORMATS),

    targetTableId: z.string().uuid(),
    cardinality: z.enum(["one", "many"]),
    symmetricFieldId: z.string().uuid(),

    linkFieldId: z.string().uuid(),
    targetFieldId: z.string().uuid(),
    fn: z.enum(["count", "sum", "avg", "min", "max"]),

    expr: z.string(),
    exprRaw: z.string(),
    error: z.string(),

    /** The parsed formula. Unknown here on purpose: its shape is the parser's
     *  business, and the SQL compiler is the thing that validates it. Re-declaring
     *  the AST in zod would give us two definitions to keep in step, and the wrong
     *  one would be the one that rejects a valid formula. */
    ast: z.unknown(),

    // button
    action: z.enum(["url", "webhook"]),
    label: z.string().max(60),
    webhookId: z.string().uuid(),
  })
  .partial();

// ─── Filter tree ────────────────────────────────────────────────────────────

export const filterOpSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "btw",
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
]);

export const dateSubOpSchema = z.enum([
  "today",
  "tomorrow",
  "yesterday",
  "oneWeekAgo",
  "oneWeekFromNow",
  "oneMonthAgo",
  "oneMonthFromNow",
  "daysAgo",
  "daysFromNow",
  "exactDate",
  "pastWeek",
  "pastMonth",
  "pastYear",
  "nextWeek",
  "nextMonth",
  "nextYear",
  "pastNumberOfDays",
  "nextNumberOfDays",
]);

export const filterLeafSchema = z.object({
  field: z.string().min(1),
  op: filterOpSchema,
  value: z.unknown().optional(),
  subOp: dateSubOpSchema.optional(),
  n: z.number().int().optional(),
});

/**
 * The tree is recursive, so the type has to be declared before zod can infer it.
 *
 * Depth is capped at 10 — the same cap the compiler enforces. A client-supplied
 * tree is client-controlled input, and "nest it 10,000 deep" is otherwise a free
 * stack overflow. Capping it here means the client gets a 400 instead of the
 * database getting a fright.
 */
export type FilterNodeInput =
  | z.infer<typeof filterLeafSchema>
  | { op: "and" | "or" | "not"; children: FilterNodeInput[] };

const MAX_FILTER_DEPTH = 10;

export const filterNodeSchema: z.ZodType<FilterNodeInput> = z.lazy(() =>
  z.union([
    filterLeafSchema,
    z.object({
      op: z.enum(["and", "or", "not"]),
      children: z.array(filterNodeSchema).max(50),
    }),
  ])
);

function depthOf(node: FilterNodeInput, depth = 0): number {
  if (!("children" in node)) return depth;
  if (!node.children.length) return depth;
  return Math.max(...node.children.map((c) => depthOf(c, depth + 1)));
}

const boundedFilterSchema = filterNodeSchema.refine(
  (n) => depthOf(n) <= MAX_FILTER_DEPTH,
  { message: `Filter nested deeper than ${MAX_FILTER_DEPTH}` }
);

// ─── Query spec ─────────────────────────────────────────────────────────────

export const sortSpecSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const cursorSchema = z.object({
  keys: z.array(z.unknown()),
  sortOrder: z.string(),
  id: z.string().uuid(),
});

export const querySpecSchema = z
  .object({
    filter: boundedFilterSchema.optional(),
    sort: z.array(sortSpecSchema).max(10).optional(),
    search: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    cursor: cursorSchema.nullish(),
  })
  .strict();

// ─── Writes ─────────────────────────────────────────────────────────────────

export const createBaseSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const createTableSchema = z
  .object({
    baseId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const createFieldSchema = z
  .object({
    tableId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    type: fieldTypeSchema,
    options: fieldOptionsSchema.optional(),
  })
  .strict();

export const updateFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: fieldTypeSchema,
    options: fieldOptionsSchema,
    isPrimary: z.boolean(),
    sortOrder: z.number(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/**
 * Record values are keyed by field.key.
 *
 * Note what is NOT here: any notion of which keys are allowed. That check needs
 * the table's field catalog, so it happens in the repo, against the database —
 * not in a static schema that would have to be kept in sync with it.
 */
export const recordValuesSchema = z.record(z.string(), z.unknown());

export const createRecordsSchema = z
  .object({
    records: z.array(recordValuesSchema).min(1).max(1000),
  })
  .strict();

export const updateRecordsSchema = z
  .object({
    patches: z
      .array(
        z.object({
          id: z.string().uuid(),
          values: recordValuesSchema,
        })
      )
      .min(1)
      .max(1000),
  })
  .strict();

export const deleteRecordsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(1000),
  })
  .strict();

/**
 * Move a record between two neighbours. The server computes the midpoint —
 * clients don't get to invent sort_order values, or two of them racing will
 * collide and the ordering becomes non-deterministic.
 */
export const moveRecordSchema = z
  .object({
    beforeId: z.string().uuid().nullish(),
    afterId: z.string().uuid().nullish(),
  })
  .strict();

// ─── Platform ───────────────────────────────────────────────────────────────

export const createTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).max(TOKEN_SCOPES.length),
    /** Optional, and it should not be. A token with no expiry is a credential
     *  that outlives the reason it was created. The UI defaults to 90 days. */
    expiresAt: z.string().datetime().nullish(),
  })
  .strict();

/**
 * A webhook URL is fetched by our server, with our credentials' worth of trust,
 * at a target the user chooses. That is the shape of an SSRF, so the scheme is
 * pinned to http(s) here and the host is checked at delivery time — a hostname
 * that resolves to a private address is refused there, not here, because DNS can
 * change between the two and only the second check is the one that matters.
 */
export const webhookUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), { message: "URL must be http or https" });

export const createWebhookSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: webhookUrlSchema,
    tableId: z.string().uuid().nullish(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
    fieldIds: z.array(z.string().uuid()).max(50).optional(),
    condition: boundedFilterSchema.nullish(),
  })
  .strict();

export const updateWebhookSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: webhookUrlSchema,
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
    fieldIds: z.array(z.string().uuid()).max(50),
    condition: boundedFilterSchema.nullable(),
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

export const uploadRequestSchema = z
  .object({
    tableId: z.string().uuid(),
    fieldId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    size: z.number().int().min(0).max(100 * 1024 * 1024),
    mime: z.string().max(120).optional(),
  })
  .strict();

// ─── The REST envelope ──────────────────────────────────────────────────────
//
// `{ id, fields }`, not `{ id, data }`. The word is the one every integration
// author already knows, and the shape is what a client can round-trip: read a
// record, change one key, PATCH it back.
//
// `fields` is keyed by field KEY, not by field NAME. Airtable keys by name and it
// is the single most common way an integration silently breaks — someone renames
// a column in the UI and a script that has run every night for a year stops. A key
// never changes. The cost is that you have to look the keys up once, from
// GET /api/v1/meta, and that is a cost worth paying.

export const restRecordSchema = z.object({
  fields: recordValuesSchema,
});

export const restCreateSchema = z
  .object({ records: z.array(restRecordSchema).min(1).max(1000) })
  .strict();

export const restPatchSchema = z
  .object({
    records: z
      .array(z.object({ id: z.string().uuid(), fields: recordValuesSchema }))
      .min(1)
      .max(1000),
  })
  .strict();
