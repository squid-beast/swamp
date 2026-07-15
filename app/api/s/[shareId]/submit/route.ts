import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PasswordRequired, submitForm } from "@/features/tables/sharing";

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

export const dynamic = "force-dynamic";

const schema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest, { params }: { params: { shareId: string } }) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const password = req.headers.get("x-swamp-share-password") ?? undefined;

  try {
    const id = await submitForm(params.shareId, password, parsed.data.values);
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof PasswordRequired) {
      return NextResponse.json({ error: "password required" }, { status: 401 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
