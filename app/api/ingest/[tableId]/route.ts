import { NextRequest, NextResponse } from "next/server";
import { apiError, apiInsert, apiMeta, apiUpsert, bearer, InvalidValues } from "@/features/tables/rest";
import { recordsFrom, resolveIngestFields, resolveUpsertKey } from "@/features/tables/ingest";
import { preflight, withCors } from "@/features/tables/cors";
import { rateLimit, tooMany, V1_WRITE_LIMIT, WINDOW_SECONDS } from "@/features/tables/rate-limit";
import { claim, finish } from "@/features/tables/idempotency";

// ── POST /api/ingest/:tableId ──
//
// The forgiving inbound endpoint for lead capture. Unlike /api/v1/…/records it
// accepts a bare flat JSON object and maps human field NAMES ("Email") as well as
// keys, so a Zapier/Make step or a website form can drop a lead straight in.
//
// Authority is unchanged: it needs a records:write Personal Access Token, checked
// inside the same SECURITY DEFINER function as the strict API. The token may arrive
// as `Authorization: Bearer …` (preferred, and the only safe option for anything
// that runs in a browser) or, for URL-only tools, as `?token=`.

export const dynamic = "force-dynamic";

function tokenFrom(req: NextRequest): string | null {
  return bearer(req) ?? req.nextUrl.searchParams.get("token");
}

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function POST(req: NextRequest, { params }: { params: { tableId: string } }) {
  const origin = req.headers.get("origin");
  const token = tokenFrom(req);

  if (!token) {
    return withCors(
      NextResponse.json(
        { error: "Missing token. Send Authorization: Bearer <token> (or ?token= for URL-only tools)." },
        { status: 401 }
      ),
      origin
    );
  }

  // Same per-token write cap as the strict API: a leaked ingest key can't hammer a
  // table before anyone notices.
  if (!(await rateLimit(`ingest:write:${token}`, V1_WRITE_LIMIT, WINDOW_SECONDS))) {
    return withCors(tooMany(WINDOW_SECONDS), origin);
  }

  // Idempotency, before we touch the body: a retried POST carrying the same key
  // replays the original response instead of creating a second lead. The bucket
  // is per token + table + client key; idempotency.ts hashes it, so the raw token
  // never lands in a table. Absent header ⇒ behaviour is exactly as before.
  const idempotencyKey =
    req.headers.get("idempotency-key") ?? req.headers.get("x-idempotency-key");
  const bucket = idempotencyKey ? `${token}:${params.tableId}:${idempotencyKey}` : null;

  if (bucket) {
    const claimed = await claim(bucket);
    if (claimed.status === "done") {
      return withCors(
        NextResponse.json(claimed.response, {
          status: 200,
          headers: { "Idempotency-Replayed": "true" },
        }),
        origin
      );
    }
    if (claimed.status === "in_flight") {
      return withCors(
        NextResponse.json(
          { error: "A request with this Idempotency-Key is already in progress." },
          { status: 409 }
        ),
        origin
      );
    }
  }

  const body = await req.json().catch(() => null);
  const incoming = recordsFrom(body);
  if (incoming.length === 0) {
    return withCors(
      NextResponse.json({ error: "Send a JSON object of fields, or { records: [...] }." }, { status: 400 }),
      origin
    );
  }
  if (incoming.length > 50) {
    return withCors(
      NextResponse.json({ error: "Too many records in one request (max 50)." }, { status: 400 }),
      origin
    );
  }

  // `upsertOn` may arrive as a query param (?upsertOn=Email) or a body field. When
  // present, the same person submitting twice updates one record instead of
  // duplicating it. Absent ⇒ plain insert, exactly as before.
  const upsertOn =
    req.nextUrl.searchParams.get("upsertOn") ??
    (body && typeof body === "object" && !Array.isArray(body)
      ? ((body as Record<string, unknown>).upsertOn as string | undefined) ?? null
      : null);

  try {
    // One meta read resolves the table's fields; the token must be allowed to see it,
    // so an unreadable table fails here with the same 404/401/403 the API uses.
    const meta = await apiMeta(token);
    const table = meta.tables.find((t) => t.id === params.tableId);
    if (!table) {
      return withCors(NextResponse.json({ error: "No such table." }, { status: 404 }), origin);
    }

    const resolved = incoming.map((r) => resolveIngestFields(table.fields, r));
    const unknownKeys = [...new Set(resolved.flatMap((r) => r.unknownKeys))];
    const rows = resolved.map((r) => ({ fields: r.fields }));

    let responseBody: Record<string, unknown>;

    if (upsertOn) {
      const keyField = resolveUpsertKey(table.fields, upsertOn);
      if (!keyField) {
        return withCors(
          NextResponse.json(
            { error: `Cannot upsert on "${upsertOn}" — no writable field matches it.` },
            { status: 400 }
          ),
          origin
        );
      }

      const { created, updated, records } = await apiUpsert(
        token,
        params.tableId,
        rows,
        keyField
      );
      responseBody = {
        records,
        created,
        updated,
        ...(unknownKeys.length ? { ignoredKeys: unknownKeys } : {}),
      };
    } else {
      const records = await apiInsert(token, params.tableId, rows);
      responseBody = {
        records,
        ...(unknownKeys.length ? { ignoredKeys: unknownKeys } : {}),
      };
    }

    // Store the body so a retry with the same key replays it verbatim.
    if (bucket) await finish(bucket, responseBody);

    // The 201 reports which incoming keys matched nothing, so an integration author
    // can see a "Fisrt Name" typo without the record silently missing a column.
    return withCors(NextResponse.json(responseBody, { status: 201 }), origin);
  } catch (e) {
    if (e instanceof InvalidValues) {
      return withCors(
        NextResponse.json({ error: "invalid values", errors: e.errors }, { status: 400 }),
        origin
      );
    }
    return withCors(apiError(e), origin);
  }
}
