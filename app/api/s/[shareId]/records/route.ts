import { NextRequest, NextResponse } from "next/server";
import { getSharedRecords, PasswordRequired } from "@/features/tables/sharing";
import { querySpecSchema } from "@/features/tables/schema";
import { preflight, withCors } from "@/features/tables/cors";

// Records for a shared view. NO AUTH — that's the point.
//
// Safety doesn't come from a guard here; it comes from the fact that this route
// cannot name a table. It passes a share_id to a SECURITY DEFINER function which
// derives the table, checks the password, applies the view's own filter, and
// scopes the query engine to the view's visible fields. A hidden column is not
// merely absent from the response — it's absent from the query.
//
// CORS-enabled so another site can read a shared view's records into its own UI.

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function POST(req: NextRequest, { params }: { params: { shareId: string } }) {
  const origin = req.headers.get("origin");
  const body = await req.json().catch(() => ({}));

  const parsed = querySpecSchema.safeParse(body?.spec ?? {});
  if (!parsed.success) {
    return withCors(NextResponse.json({ error: "invalid query" }, { status: 400 }), origin);
  }

  // The password rides in a header, not the URL. A URL ends up in browser history,
  // server logs, and every Referer header the page ever sends.
  const password = req.headers.get("x-swamp-share-password") ?? undefined;

  try {
    return withCors(
      NextResponse.json(await getSharedRecords(params.shareId, password, parsed.data)),
      origin
    );
  } catch (e) {
    if (e instanceof PasswordRequired) {
      return withCors(
        NextResponse.json({ error: "password required" }, { status: 401 }),
        origin
      );
    }
    return withCors(NextResponse.json({ error: (e as Error).message }, { status: 400 }), origin);
  }
}
