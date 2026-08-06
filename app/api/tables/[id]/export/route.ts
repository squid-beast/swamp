import { NextRequest, NextResponse } from "next/server";
import { getTable, listFields, queryRecords } from "@/features/tables/repo";
import { loadViewConfig } from "@/features/tables/view-config";
import { csvRow } from "@/features/tables/csv";
import { requireAuth } from "@/shared/supabase/server";
import type { Field, QuerySpec } from "@/features/tables/types";

// Export, honouring the view's filters, sorts and visible fields.
// `?format=csv|json|xlsx` — csv unless asked.
//
// ── Why csv/json stream and xlsx does not ──
//
// The obvious implementation builds the whole file in a string and returns it.
// That's fine for 5,000 rows — and 5,000 rows is exactly the ceiling we spent
// Phase 1 removing. So CSV and JSON page through the query engine with the same
// cursor the grid uses and push each page into a ReadableStream: memory stays
// flat regardless of table size.
//
// XLSX CANNOT stream — SheetJS builds the whole workbook in memory. Rather than
// reintroduce the ceiling and dress it up as a feature, xlsx has an honest hard
// cap (XLSX_MAX_ROWS) and a 413 above it that points at CSV.

export const dynamic = "force-dynamic";
// 60 is Vercel Hobby's ceiling — 300 requires Pro and silently clamps on Hobby.
export const maxDuration = 60;

const PAGE = 500;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const table = await getTable(params.id);
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

  const viewId = req.nextUrl.searchParams.get("viewId");
  const allFields = await listFields(params.id);

  let spec: QuerySpec = {};
  let fields: Field[] = allFields;

  if (viewId) {
    const config = await loadViewConfig(viewId, params.id);

    spec = {
      ...(config.filter ? { filter: config.filter } : {}),
      ...(config.sorts.length ? { sort: config.sorts } : {}),
    };

    // Only the fields the view actually shows, in the order it shows them. An
    // export that includes columns you deliberately hid is not an export of what
    // you were looking at.
    const shown = new Map(config.viewFields.map((vf) => [vf.fieldId, vf]));
    fields = allFields
      .filter((f) => shown.get(f.id)?.show !== false)
      .sort(
        (a, b) =>
          (shown.get(a.id)?.sortOrder ?? a.sortOrder) -
          (shown.get(b.id)?.sortOrder ?? b.sortOrder)
      );
  }

  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const stem = table.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const encoder = new TextEncoder();

  if (format === "xlsx") {
    // In-memory by necessity (see header). Capped, and honest about it.
    const XLSX_MAX_ROWS = 50_000;
    const rows: unknown[][] = [fields.map((f) => f.name)];

    let cursor = null as QuerySpec["cursor"];
    for (;;) {
      const page = await queryRecords(params.id, { ...spec, limit: PAGE, cursor });
      for (const record of page.records) {
        rows.push(fields.map((f) => {
          const v = record.data[f.key];
          return Array.isArray(v) ? v.join(", ") : v;
        }));
        // `rows` carries the header, so the DATA count is length - 1. Comparing
        // the raw length would 413 a table of exactly XLSX_MAX_ROWS rows while
        // the message promised it was allowed.
        if (rows.length - 1 > XLSX_MAX_ROWS) {
          return NextResponse.json(
            { error: `xlsx export is capped at ${XLSX_MAX_ROWS} rows — use format=csv, which streams` },
            { status: 413 }
          );
        }
      }
      if (!page.next) break;
      cursor = page.next;
    }

    const { utils, write } = await import("xlsx");
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.aoa_to_sheet(rows), table.name.slice(0, 31) || "Sheet1");
    const buf = write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${stem}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const isJson = format === "json";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (isJson) controller.enqueue(encoder.encode("["));
        else controller.enqueue(encoder.encode(csvRow(fields.map((f) => f.name))));

        let first = true;
        let cursor = null as QuerySpec["cursor"];
        for (;;) {
          const page = await queryRecords(params.id, { ...spec, limit: PAGE, cursor });

          for (const record of page.records) {
            if (isJson) {
              // Keyed by field KEY, not name. Duplicate names are a SUPPORTED
              // state (see field-key.ts: "Two columns called 'Name' is not a
              // mistake — real CSVs do it"), so keying by name would silently
              // drop columns. Key is also what /api/v1 speaks, so a JSON export
              // round-trips through the API unchanged.
              const obj: Record<string, unknown> = {};
              for (const f of fields) obj[f.key] = record.data[f.key] ?? null;
              controller.enqueue(
                encoder.encode(`${first ? "\n" : ",\n"}  ${JSON.stringify(obj)}`)
              );
              first = false;
            } else {
              controller.enqueue(
                encoder.encode(csvRow(fields.map((f) => record.data[f.key])))
              );
            }
          }

          if (!page.next) break;
          cursor = page.next;
        }

        if (isJson) controller.enqueue(encoder.encode("\n]\n"));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stem}.${isJson ? "json" : "csv"}"`,
      "Cache-Control": "no-store",
    },
  });
}
