import "server-only";
import { NextResponse } from "next/server";
import { createPublicClient } from "@/shared/supabase/public";
import { sanitizeValues, type WriteError } from "./repo";
import { encodeCursor } from "./rest-query";
import type { Field, FieldOptions, FieldType, QuerySpec } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// The public REST API.
//
// Every call in this file goes to a SECURITY DEFINER function, on a connection
// with NO ambient authority — an anon client, no cookies, no service key. The
// function takes the token, resolves it to a person, recomputes that person's
// role from live membership, checks the scope, and only then touches a row.
//
// So there is no authorization logic in this file, and there must never be one.
// The moment a check lives here, it can be forgotten here.
//
// ── The envelope ──
//
//     { "id": "...", "fields": { "fld_name": "Acme" }, "createdTime": "..." }
//
// `fields` is keyed by field KEY, not name. Airtable keys by name, and it is the
// most common way an integration breaks silently: someone renames a column in the
// UI on a Tuesday and a script that has run every night for a year stops. A key
// never changes. You look them up once from GET /api/v1/meta.
// ════════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

export interface ApiRecord {
  id: string;
  fields: Row;
  createdTime?: string;
}

export interface ApiPage {
  records: ApiRecord[];
  /** Opaque. Pass it back as `?cursor=`. Absent means you have everything. */
  cursor?: string;
  total?: number;
}

/** `Authorization: Bearer swamp_pat_…`. Nothing else — not a query param, which
 *  would put the token in every access log and every Referer header. */
export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Turn a database error into an HTTP status.
 *
 * The SQLSTATEs are chosen in the migration to carry exactly this meaning:
 *
 *   28000 — the token is not good (missing, revoked, expired, owner removed) → 401
 *   42501 — the token is good but not allowed to do this                     → 403
 *   42P01 — no such table in this base                                       → 404
 *
 * A table in someone else's base is a 404, not a 403. A 403 would confirm the
 * table exists, and a token holder could enumerate ids across the database.
 */
export function apiError(e: unknown): NextResponse {
  const err = e as { code?: string; message?: string };
  const message = (err?.message ?? "request failed").replace(/^swamp:\s*/, "");

  const status =
    err?.code === "28000" ? 401 :
    err?.code === "42501" ? 403 :
    err?.code === "42P01" ? 404 :
    400;

  return NextResponse.json({ error: message }, { status });
}

function db() {
  return createPublicClient();
}

async function rpc<T>(fn: string, args: Row): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ─── Meta ───────────────────────────────────────────────────────────────────

export interface ApiField {
  id: string;
  name: string;
  key: string;
  type: FieldType;
  options: FieldOptions;
  isPrimary: boolean;
  readOnly: boolean;
}

export interface ApiMeta {
  base: { id: string; name: string };
  tables: { id: string; name: string; fields: ApiField[] }[];
}

export function apiMeta(token: string): Promise<ApiMeta> {
  return rpc<ApiMeta>("swamp_api_meta", { p_token: token });
}

/**
 * The fields of one table, for validation.
 *
 * Yes, this fetches the whole base's meta to get one table's fields. It is one
 * cheap query and it means there is no second "give me a table's fields by token"
 * function to secure. Fewer doors.
 */
async function fieldsOf(token: string, tableId: string): Promise<Field[]> {
  const meta = await apiMeta(token);
  const table = meta.tables.find((t) => t.id === tableId);

  if (!table) {
    throw Object.assign(new Error("swamp: no such table"), { code: "42P01" });
  }

  return table.fields.map(
    (f): Field => ({
      id: f.id,
      tableId,
      baseId: meta.base.id,
      name: f.name,
      key: f.key,
      type: f.type,
      options: f.options ?? {},
      isPrimary: f.isPrimary,
      sortOrder: 0,
    })
  );
}

// ─── Read ───────────────────────────────────────────────────────────────────

interface RawPage {
  records: {
    id: string;
    data: Row;
    createdAt: string;
    sortOrder: string;
  }[];
  next: unknown | null;
}

export async function apiQuery(
  token: string,
  tableId: string,
  spec: QuerySpec,
  wantCount = false
): Promise<ApiPage> {
  const [page, total] = await Promise.all([
    rpc<RawPage>("swamp_api_query", {
      p_token: token,
      p_table_id: tableId,
      p_spec: spec,
    }),
    wantCount
      ? rpc<number>("swamp_api_count", {
          p_token: token,
          p_table_id: tableId,
          p_spec: spec,
        })
      : Promise.resolve(undefined),
  ]);

  return {
    records: (page.records ?? []).map((r) => ({
      id: r.id,
      fields: r.data ?? {},
      createdTime: r.createdAt,
    })),
    ...(page.next ? { cursor: encodeCursor(page.next) } : {}),
    ...(total !== undefined ? { total: Number(total) } : {}),
  };
}

export async function apiGet(
  token: string,
  tableId: string,
  recordId: string
): Promise<ApiRecord> {
  const r = await rpc<{ id: string; data: Row; createdAt: string }>("swamp_api_get", {
    p_token: token,
    p_table_id: tableId,
    p_record_id: recordId,
  });

  return { id: r.id, fields: r.data ?? {}, createdTime: r.createdAt };
}

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Validation happens TWICE, on purpose.
 *
 *   Here, in TypeScript, against the field types — so `{"fld_amount": "banana"}`
 *   comes back as a 400 that names the field, rather than as a currency column
 *   containing the word banana.
 *
 *   And in SQL, in swamp_pick_writable — which drops any key that isn't a
 *   writable field, whatever this file did or forgot to do.
 *
 * The first is a good error message. The second is the boundary. Don't confuse
 * them: if this file disappeared, the database would still be safe.
 */
function validate(fields: Field[], rows: Row[]): WriteError[] {
  const errors: WriteError[] = [];

  rows.forEach((values, i) => {
    errors.push(...sanitizeValues(fields, values, i).errors);
  });

  return errors;
}

export class InvalidValues extends Error {
  constructor(public errors: WriteError[]) {
    super("invalid values");
    this.name = "InvalidValues";
  }
}

export async function apiInsert(
  token: string,
  tableId: string,
  records: { fields: Row }[]
): Promise<ApiRecord[]> {
  const fields = await fieldsOf(token, tableId);

  const errors = validate(fields, records.map((r) => r.fields));
  if (errors.length) throw new InvalidValues(errors);

  const created = await rpc<{ id: string; fields: Row; createdTime: string }[]>(
    "swamp_api_insert",
    { p_token: token, p_table_id: tableId, p_records: records }
  );

  return created ?? [];
}

export async function apiPatch(
  token: string,
  tableId: string,
  records: { id: string; fields: Row }[]
): Promise<ApiRecord[]> {
  const fields = await fieldsOf(token, tableId);

  const errors = validate(fields, records.map((r) => r.fields));
  if (errors.length) throw new InvalidValues(errors);

  const updated = await rpc<ApiRecord[]>("swamp_api_patch", {
    p_token: token,
    p_table_id: tableId,
    p_records: records,
  });

  return updated ?? [];
}

/** Soft delete, like everywhere else. Returns how many rows it actually touched —
 *  an id that was already deleted, or never existed, is simply not counted. */
export function apiDelete(token: string, tableId: string, ids: string[]): Promise<number> {
  return rpc<number>("swamp_api_delete", {
    p_token: token,
    p_table_id: tableId,
    p_ids: ids,
  });
}
