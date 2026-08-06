import { NextRequest, NextResponse } from "next/server";
import {
  getSharedMeta,
  getSharedRecords,
  PasswordRequired,
} from "@/features/tables/sharing";
import { csvRow } from "@/features/tables/csv";

// CSV export of a shared view — only if the owner allowed it.
//
// Streams, and honours the view's filter and visible fields, because it goes
// through the same swamp_shared_records the page does. There is no second code
// path that could accidentally include a hidden column.

export const dynamic = "force-dynamic";
// 60 is Vercel Hobby's ceiling — 300 requires Pro and silently clamps on Hobby.
export const maxDuration = 60;

const PAGE = 500;


export async function GET(req: NextRequest, { params }: { params: { shareId: string } }) {
  const password =
    req.headers.get("x-swamp-share-password") ??
    req.nextUrl.searchParams.get("p") ??
    undefined;

  let meta;
  try {
    meta = await getSharedMeta(params.shareId, password);
  } catch (e) {
    if (e instanceof PasswordRequired) {
      return NextResponse.json({ error: "password required" }, { status: 401 });
    }
    throw e;
  }

  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Downloading is off unless the owner turned it on. Sharing a view to be read is
  // not the same as sharing it to be taken away, and conflating the two is how a
  // "just have a look" link becomes a data export.
  if (!meta.view.shareOptions?.allowDownload) {
    return NextResponse.json({ error: "downloads are not enabled" }, { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvRow(meta.fields.map((f) => f.name))));

        let cursor = null;
        for (;;) {
          const page = await getSharedRecords(params.shareId, password, {
            limit: PAGE,
            cursor,
          });

          for (const record of page.records) {
            controller.enqueue(
              encoder.encode(csvRow(meta.fields.map((f) => record.data[f.key])))
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

  const filename = `${meta.table.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
