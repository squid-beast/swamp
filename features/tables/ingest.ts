import type { ApiField } from "./rest";

// ════════════════════════════════════════════════════════════════════════════
// Inbound ingest — the forgiving front door for leads.
//
// The v1 API is strict on purpose: it keys by field KEY and takes a
// { records: [{ fields }] } envelope, which is right for a script you control. But
// a Zapier zap, a Make scenario, or a plain HTML form posts whatever shape it has,
// with human field NAMES ("Email", "Full Name"), and rejecting that outright is how
// a lead-capture integration quietly drops every lead.
//
// So this layer is deliberately lenient about SHAPE and NAMING, and delegates every
// question of AUTHORITY and VALUE-VALIDITY to the same SECURITY DEFINER path the
// strict API uses. It never relaxes what a token may do — only what a payload may
// look like.
// ════════════════════════════════════════════════════════════════════════════

/** Pull the record payloads out of whatever the caller sent.
 *
 *  Accepts, most-specific first:
 *    { records: [{ fields: {...} }, ...] }   — the strict v1 envelope
 *    { records: [{...}, ...] }               — array of flat objects
 *    { fields: {...} }                       — one record, fields-wrapped
 *    { ...flat }                             — one record, bare (the webform case)
 */
export function recordsFrom(body: unknown): Record<string, unknown>[] {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;

    if (Array.isArray(obj.records)) {
      return obj.records
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) =>
          r.fields && typeof r.fields === "object"
            ? (r.fields as Record<string, unknown>)
            : r
        );
    }

    if (obj.fields && typeof obj.fields === "object") {
      return [obj.fields as Record<string, unknown>];
    }

    // A bare flat object — the plainest possible POST.
    return [obj];
  }

  return [];
}

export interface ResolvedIngest {
  /** Keyed by field KEY, ready for the strict insert path. */
  fields: Record<string, unknown>;
  /** Incoming keys that matched no field — surfaced so a caller can spot a typo. */
  unknownKeys: string[];
}

/**
 * Translate an incoming object into `{ fieldKey: value }`, matching each incoming
 * key against a field's KEY first, then its NAME, case- and whitespace-insensitively.
 *
 * Read-only fields (formulas, rollups, the created/modified stamps) are dropped
 * here rather than sent and rejected — an inbound payload that happens to carry a
 * "Created time" should not fail the whole record.
 */
export function resolveIngestFields(
  fields: Pick<ApiField, "key" | "name" | "readOnly">[],
  input: Record<string, unknown>
): ResolvedIngest {
  const byKey = new Map(fields.map((f) => [f.key.toLowerCase(), f]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase().trim(), f]));

  const out: Record<string, unknown> = {};
  const unknownKeys: string[] = [];

  for (const [rawKey, value] of Object.entries(input)) {
    const needle = rawKey.toLowerCase().trim();
    const field = byKey.get(needle) ?? byName.get(needle);

    if (!field) {
      unknownKeys.push(rawKey);
      continue;
    }
    if (field.readOnly) continue; // never accept a computed/stamped field

    // Last write wins if both a key and its display name are sent — vanishingly
    // rare, and there is no better answer than "the most recently seen value".
    out[field.key] = value;
  }

  return { fields: out, unknownKeys };
}

/**
 * Resolve a user-supplied `upsertOn` ("Email") to a field KEY, using the same
 * case/whitespace-insensitive key-then-name matching as resolveIngestFields.
 *
 * Returns null if it matches no field, or if the matched field is read-only —
 * upserting on a formula or a created stamp is never what the caller means, and
 * the SQL would refuse it anyway. Null tells the route to answer 400.
 */
export function resolveUpsertKey(
  fields: Pick<ApiField, "key" | "name" | "readOnly">[],
  upsertOn: string
): string | null {
  const byKey = new Map(fields.map((f) => [f.key.toLowerCase(), f]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase().trim(), f]));

  const needle = upsertOn.toLowerCase().trim();
  const field = byKey.get(needle) ?? byName.get(needle);

  if (!field || field.readOnly) return null;

  return field.key;
}
