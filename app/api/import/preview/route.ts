import { NextRequest, NextResponse } from "next/server";
import { parseFile, ImportError } from "@/features/tables/import-service";
import { fetchImportUrl } from "@/features/tables/engine/import-url";
import { requireAuth } from "@/shared/supabase/server";

// Parse a source to its columns + a few sample rows, WITHOUT importing — so the UI
// can offer a destination and a column mapping before anything is written. The apply
// step re-parses from the same source (the client re-sends the file / URL), so no
// parsed state is held server-side between the two calls.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SAMPLE = 5;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const contentType = req.headers.get("content-type") ?? "";

  try {
    let columns: string[];
    let rows: Record<string, unknown>[];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file." }, { status: 400 });
      }
      const buf = await file.arrayBuffer();
      const parsed = parseFile(file.name, buf, new TextDecoder().decode(buf));
      columns = parsed.columns;
      rows = parsed.rows;
    } else {
      const { url } = await req.json();
      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "Enter a URL." }, { status: 400 });
      }
      const fetched = await fetchImportUrl(url);
      const parsed = parseFile(fetched.filename, fetched.buf, fetched.text);
      columns = parsed.columns;
      rows = parsed.rows;
    }

    if (!columns.length) {
      return NextResponse.json({ error: "No columns found." }, { status: 400 });
    }

    return NextResponse.json({
      columns,
      sample: rows.slice(0, SAMPLE),
      rowCount: rows.length,
    });
  } catch (e) {
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("import/preview failed:", e);
    return NextResponse.json({ error: "Couldn't read that source." }, { status: 400 });
  }
}
