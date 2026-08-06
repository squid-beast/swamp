import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";
import { shareView, unshareView } from "@/features/tables/sharing";

// Share or revoke a view.
//
// The password is hashed IN POSTGRES (bcrypt, via pgcrypto). It is never stored,
// logged, or returned — once set, the only thing the owner can do is replace it.
// That's deliberate: a "show password" affordance means the plaintext has to live
// somewhere, and it doesn't.

export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().max(200).optional(),
  allowDownload: z.boolean().optional(),
  /** Vanity alias for the link. GUESSABLE BY CONSTRUCTION — the random share id
   *  is the security property, and a slug trades it away; pair with a password
   *  for anything that shouldn't be public. Empty string clears it. */
  slug: z
    .union([z.literal(""), z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/)])
    .optional(),
});

/** Slugs that must never shadow a real route under /s/.
 *
 *  Belt to the regex's braces: the 3-character floor above already makes the
 *  only real collision (`/s/b/…`, the shared-base landing) unreachable. These
 *  are the words a future route is most likely to want. */
const RESERVED_SLUGS = new Set(["api", "app", "auth", "new", "admin", "static", "public"]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Reject a bad slug BEFORE anything is written. These are separate statements,
  // not one transaction, so validating late meant a rejected slug could still
  // leave a freshly-minted share behind — a 400 that had already shared the view.
  const slug = parsed.data.slug === undefined ? undefined : parsed.data.slug || null;
  if (slug && RESERVED_SLUGS.has(slug)) {
    return NextResponse.json({ error: "that slug is reserved" }, { status: 400 });
  }

  try {
    const db = createClient();

    // ── Why this is not an unconditional shareView() ──
    //
    // swamp_share_view ALWAYS mints a fresh share_id and sets the password hash
    // from its argument — passing null CLEARS an existing password. Calling it on
    // every POST meant `{"slug":"pricing"}` (no password key) silently rotated the
    // link AND unprotected a password-gated share. So (re)share only when the
    // caller actually asked to:
    //
    //   · `password` present  → explicit (re)share: rotate the id, set/clear the gate.
    //   · not yet shared      → first share.
    //   · otherwise           → this is a settings edit; leave the link alone.
    const { data: existing } = await db
      .from("views")
      .select("share_id, share_options")
      .eq("id", params.id)
      .maybeSingle();

    // Claim the slug FIRST, while a failure still costs nothing. The unique
    // index is the arbiter of "taken".
    if (slug !== undefined) {
      const { error } = await db
        .from("views")
        .update({ share_slug: slug })
        .eq("id", params.id);
      if (error) return NextResponse.json({ error: "that slug is taken" }, { status: 409 });
    }

    const wantsReshare = parsed.data.password !== undefined || !existing?.share_id;

    const shareId = wantsReshare
      ? await shareView(params.id, parsed.data.password)
      : (existing!.share_id as string);

    if (parsed.data.allowDownload !== undefined) {
      // MERGE, don't replace: share_options also carries `embed`, and a
      // wholesale write would drop every key the caller didn't mention.
      const current = (existing?.share_options as Record<string, unknown>) ?? {};
      await db
        .from("views")
        .update({ share_options: { ...current, allowDownload: parsed.data.allowDownload } })
        .eq("id", params.id);
    }

    return NextResponse.json({ shareId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    await unshareView(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
