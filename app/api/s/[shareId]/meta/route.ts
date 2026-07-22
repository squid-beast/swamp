import { NextRequest, NextResponse } from "next/server";
import { getSharedMeta, PasswordRequired } from "@/features/tables/sharing";
import { preflight, withCors } from "@/features/tables/cors";

// GET /api/s/:shareId/meta
//
// The form's schema, as JSON, for a headless embed. This is what lets another
// site render its OWN form UI over a SWAMP form: it fetches the fields, their
// labels, help text, required flags, conditional visibility and limited options,
// then POSTs answers back to /api/s/:shareId/submit.
//
// It is CORS-enabled because that is the entire point — the caller is a browser
// on another origin. It is safe to be: the response is exactly what the shared
// page already renders to any anonymous visitor, and it names no table id, so it
// grants nothing a visit to /s/:shareId did not already.

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest, { params }: { params: { shareId: string } }) {
  const origin = req.headers.get("origin");

  const password =
    req.headers.get("x-swamp-share-password") ??
    req.nextUrl.searchParams.get("p") ??
    undefined;

  let meta;
  try {
    meta = await getSharedMeta(params.shareId, password);
  } catch (e) {
    if (e instanceof PasswordRequired) {
      return withCors(
        NextResponse.json({ error: "password required" }, { status: 401 }),
        origin
      );
    }
    throw e;
  }

  if (!meta) {
    return withCors(NextResponse.json({ error: "not found" }, { status: 404 }), origin);
  }

  return withCors(NextResponse.json(meta), origin);
}
