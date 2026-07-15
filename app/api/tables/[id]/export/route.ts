import { NextRequest, NextResponse } from "next/server";
import { getTable, listFields, queryRecords } from "@/features/tables/repo";
import { loadViewConfig } from "@/features/tables/view-config";
import { requireAuth } from "@/shared/supabase/server";
import type { Field, QuerySpec } from "@/features/tables/types";

// CSV export, honouring the view's filters, sorts and visible fields.
//
// ── Why this streams ──
//
// The obvious implementation builds the whole CSV in a string and returns it.
// That's fine for 5,000 rows — and 5,000 rows is exactly the ceiling we spent
// Phase 1 removing. A 500,000-row export would build a ~200MB string in server
// memory and fall over.
//
// So it pages through the query engine with the same cursor the grid uses and
// pushes each page into a ReadableStream. Memory stays flat regardless of table
// size, and the browser starts saving immediately instead of waiting.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 500;

/** RFC 4180: quote if the value contains a comma, quote or newline; double any quotes. */
function csvCell(value: unknown): string {
  if (value == null) return "";

  const s = Array.isArray(value) ? value.join(", ") : String(value);
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

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

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvRow(fields.map((f) => f.name))));

        let cursor = null as QuerySpec["cursor"];
        for (;;) {
          const page = await queryRecords(params.id, { ...spec, limit: PAGE, cursor });

          for (const record of page.records) {
            controller.enqueue(
              encoder.encode(csvRow(fields.map((f) => record.data[f.key])))
            );
          }

          if (!page.next) break;
          cursor = page.next;
        }

        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const filename = `${table.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
