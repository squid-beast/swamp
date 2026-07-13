import { NextRequest, NextResponse } from "next/server";
import { ingest, parseCSV, parseJSON, parseXLSX } from "@/features/datasets/engine/import";
import { store } from "@/features/datasets/storage/store";
import { requireAuth } from "@/shared/supabase/server";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json(await store.list());
}

// Import endpoint: multipart file upload OR raw JSON body (doubles as webhook ingest).
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
      const name = (form.get("name") as string) || file.name.replace(/\.\w+$/, "");
      const ext = file.name.split(".").pop()?.toLowerCase();

      let table;
      if (ext === "csv") table = parseCSV(await file.text());
      else if (ext === "xlsx" || ext === "xls") table = parseXLSX(await file.arrayBuffer());
      else if (ext === "json") table = parseJSON(await file.text());
      else return NextResponse.json({ error: `unsupported: .${ext}` }, { status: 400 });

      const kind = ext === "csv" ? "csv" : ext === "json" ? "json" : "xlsx";
      const { dataset, rows } = ingest(name, { kind }, table);
      await store.create(dataset, rows);
      return NextResponse.json({ id: dataset.id });
    }

    // raw JSON body → webhook-style ingest
    const text = await req.text();
    const name = req.nextUrl.searchParams.get("name") || `Webhook ${new Date().toLocaleString()}`;
    const table = parseJSON(text);
    const { dataset, rows } = ingest(name, { kind: "webhook" }, table);
    await store.create(dataset, rows);
    return NextResponse.json({ id: dataset.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
