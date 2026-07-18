import { NextRequest, NextResponse } from "next/server";
import { parseFile, ImportError } from "@/features/tables/import-service";
import { applyImport } from "@/features/tables/import-apply";
import { fetchImportUrl } from "@/features/tables/engine/import-url";
import { requireAuth } from "@/shared/supabase/server";

// URL in, real table out. Its own route (not /api/import) because that endpoint's
// non-multipart branch already means "the body IS the JSON to import", and a
// { url } body would be ambiguous with it.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { url, name, baseId, tableId, keyField, mapping } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Enter a URL to import." }, { status: 400 });
    }

    const fetched = await fetchImportUrl(url);
    const parsed = parseFile(fetched.filename, fetched.buf, fetched.text);
    if (!parsed.columns.length) {
      return NextResponse.json({ error: "No columns found at that URL." }, { status: 400 });
    }

    const tableName =
      (typeof name === "string" && name.trim()) ||
      fetched.filename.replace(/\.[^.]+$/, "") ||
      "Imported";

    const result = await applyImport(tableName, parsed, {
      baseId: typeof baseId === "string" ? baseId : undefined,
      tableId: typeof tableId === "string" ? tableId : undefined,
      keyField: typeof keyField === "string" ? keyField : undefined,
      mapping: mapping && typeof mapping === "object" ? mapping : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    // Deliberately-thrown ImportErrors are safe to show. Anything else — a raw DB
    // error, a malformed body, a bug — is logged and genericised so schema and RLS
    // policy names never reach the client.
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("import/url failed:", e);
    return NextResponse.json({ error: "Import failed. Please try again." }, { status: 400 });
  }
}
