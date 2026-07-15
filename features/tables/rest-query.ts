import { querySpecSchema } from "./schema";
import type { QuerySpec } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// The REST read: a query string in, a QuerySpec out.
//
// Pure. No database, no request object, no `server-only` — which is what makes it
// testable, and it is worth testing: a query string is the least type-safe input
// surface in the product. Everything arrives as a string, including the numbers,
// including the booleans, including the nulls.
//
// The app itself POSTs a JSON spec (a filter tree does not survive a query string
// without being reinvented as one). But an API is used from a shell, and
//
//     curl -H "Authorization: Bearer $T" ".../records?limit=5&sort=fld_name"
//
// has to work, or nobody will try the second command.
// ════════════════════════════════════════════════════════════════════════════

export class BadQuery extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadQuery";
  }
}

/**
 * The cursor is opaque, and deliberately.
 *
 * It is a keyset — the values of the sort expressions for the last row on the
 * page — and if it looked like structured data somebody would build a client that
 * constructs one, which would make the internal shape of the ordering tuple a
 * public contract we could never change. Base64 says: this came from us, hand it
 * back, don't read it.
 */
export function encodeCursor(cursor: unknown): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadQuery("cursor is not valid — pass back the one you were given");
  }
}

/** `?sort=fld_amount:desc,fld_name` → [{field, dir}]. Ascending by default. */
function parseSort(raw: string): { field: string; dir: "asc" | "desc" }[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [field, dir = "asc"] = part.split(":").map((s) => s.trim());
      if (!field) throw new BadQuery(`sort: "${part}" has no field`);
      if (dir !== "asc" && dir !== "desc") {
        throw new BadQuery(`sort: "${dir}" is not asc or desc`);
      }
      return { field, dir };
    });
}

/**
 * Build a spec from query params.
 *
 * Every field goes through `querySpecSchema` at the end — the same schema the
 * app's own POST body goes through. There is one definition of a valid query and
 * both doors use it.
 */
export function parseRestQuery(params: URLSearchParams): QuerySpec {
  const raw: Record<string, unknown> = {};

  const limit = params.get("limit");
  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n)) throw new BadQuery(`limit: "${limit}" is not a whole number`);
    raw.limit = n;
  }

  const search = params.get("search");
  if (search) raw.search = search;

  const sort = params.get("sort");
  if (sort) raw.sort = parseSort(sort);

  const filter = params.get("filter");
  if (filter) {
    try {
      raw.filter = JSON.parse(filter);
    } catch {
      throw new BadQuery("filter: not valid JSON");
    }
  }

  const cursor = params.get("cursor");
  if (cursor) raw.cursor = decodeCursor(cursor);

  const parsed = querySpecSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BadQuery(`${first.path.join(".") || "query"}: ${first.message}`);
  }

  return parsed.data as QuerySpec;
}
