import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PasswordRequired, submitForm } from "@/features/tables/sharing";
import { preflight, withCors } from "@/features/tables/cors";
import {
  clientIp,
  FORM_SUBMIT_LIMIT,
  rateLimit,
  tooMany,
  WINDOW_SECONDS,
} from "@/features/tables/rate-limit";

// A form submission, from an anonymous visitor.
//
// The only public WRITE in the product. It's narrow on purpose:
//   • the shared view must be a FORM — sharing a grid publicly must not make it
//     writable;
//   • only fields the form displays can be set. Posting a key the form doesn't
//     show does nothing, which is what stops someone POSTing
//     {"fld_internal_score": 100} at your contact form.
//
// Both rules live in swamp_submit_form, not here. A guard in a route handler is
// one `if` away from being forgotten; a guard in the function every caller must
// go through is not.
//
// CORS-enabled and rate-limited: it is meant to be POSTed from another site's
// form, so it has to answer preflight, and an open public write has to be capped
// per IP+form or it is a way to fill a table for free.

export const dynamic = "force-dynamic";

const schema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function POST(req: NextRequest, { params }: { params: { shareId: string } }) {
  const origin = req.headers.get("origin");

  const ok = await rateLimit(
    `form:${params.shareId}:${clientIp(req)}`,
    FORM_SUBMIT_LIMIT,
    WINDOW_SECONDS
  );
  if (!ok) return withCors(tooMany(WINDOW_SECONDS), origin);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return withCors(NextResponse.json({ error: "invalid body" }, { status: 400 }), origin);
  }

  const password = req.headers.get("x-swamp-share-password") ?? undefined;

  try {
    const id = await submitForm(params.shareId, password, parsed.data.values);
    return withCors(NextResponse.json({ id }), origin);
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
