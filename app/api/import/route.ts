import { NextRequest, NextResponse } from "next/server";
import { importTable, parseFile, ImportError } from "@/features/tables/import-service";
import { applyImport, type ImportDestination } from "@/features/tables/import-apply";
import { parseJSON } from "@/features/tables/engine/import";
import { requireAuth } from "@/shared/supabase/server";

// Read the optional destination (new table vs an existing one to upsert into) off a
// multipart form. Absent tableId → new table, exactly as before.
function formDestination(form: FormData): ImportDestination {
  const s = (k: string) => (form.get(k) as string | null)?.trim() || undefined;
  const mappingRaw = s("mapping");
  let mapping: Record<string, string> | undefined;
  if (mappingRaw) {
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      throw new ImportError("Bad column mapping.");
    }
  }
  return { baseId: s("baseId"), tableId: s("tableId"), keyField: s("keyField"), mapping };
}

// File in, real table out.
//
// Two entry points, same destination:
//   multipart  → a CSV / XLSX / JSON file upload
//   json body  → a webhook payload
//
// Both end up as a base + table + fields + a default grid view + records. There
// is no `Dataset` object any more.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "no file" }, { status: 400 });
      }

      const buf = await file.arrayBuffer();
      // XLSX needs the bytes, CSV/JSON need the text. Decoding both up front is
      // cheaper than guessing wrong and re-reading a stream you've consumed.
      const text = new TextDecoder().decode(buf);

      const parsed = parseFile(file.name, buf, text);
      if (!parsed.columns.length) {
        return NextResponse.json({ error: "no columns found in file" }, { status: 400 });
      }

      const name =
        (form.get("name") as string | null)?.trim() ||
        file.name.replace(/\.[^.]+$/, "") ||
        "Imported";

      const result = await applyImport(name, parsed, formDestination(form));
      return NextResponse.json(result);
    }

    // Webhook / raw JSON.
    const text = await req.text();
    const parsed = parseJSON(text);
    if (!parsed.columns.length) {
      return NextResponse.json({ error: "no columns found in payload" }, { status: 400 });
    }

    const name = req.nextUrl.searchParams.get("name")?.trim() || "Imported";
    const result = await importTable(name, parsed, {
      baseId: req.nextUrl.searchParams.get("baseId") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("import failed:", e);
    return NextResponse.json({ error: "Import failed. Please try again." }, { status: 400 });
  }
}
