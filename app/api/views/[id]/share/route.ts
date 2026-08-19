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
  /** Present = change the gate. "" clears it. Absent = leave it alone. */
  password: z.string().max(200).optional(),
  /** Explicitly mint a NEW share id, invalidating the current link. Rotation is
   *  a decision, never a side effect of editing a setting. */
  regenerate: z.boolean().optional(),
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

// The dialog had no way to read this, so it opened in "not shared" state every
// time — and its Create button rotated the link you had already sent people.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { data, error } = await createClient()
    .from("views")
    .select("share_id, share_slug, share_password_hash, share_options")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  const options = (data.share_options as { allowDownload?: boolean } | null) ?? {};

  return NextResponse.json({
    shareId: data.share_id,
    slug: data.share_slug,
    // A BOOLEAN, never the hash. Whether a gate exists is a setting the owner
    // needs to see; the gate itself is a bcrypt hash and stays in Postgres.
    hasPassword: Boolean(data.share_password_hash),
    allowDownload: Boolean(options.allowDownload),
  });
}

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

    // swamp_share_view ALWAYS mints a fresh share_id and sets the password hash
    // from its argument — passing null CLEARS an existing password. Calling it on
    // every POST meant `{"slug":"pricing"}` (no password key) silently rotated the
    // link AND unprotected a password-gated share. The current state decides what
    // this request means; see the three intents below.
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

    // Three distinct intents, and only the first two touch the link:
    //
    //   · not shared yet          → mint (and set the gate if one was sent)
    //   · regenerate: true        → mint a NEW id, invalidating the old link
    //   · already shared          → edit settings in place. A password sent here
    //                               changes the gate WITHOUT rotating, which is
    //                               the operation that previously had no path:
    //                               swamp_share_view always re-mints.
    const firstShare = !existing?.share_id;
    const rotate = firstShare || parsed.data.regenerate === true;

    let shareId: string;
    if (rotate) {
      shareId = await shareView(params.id, parsed.data.password);
    } else {
      shareId = existing!.share_id as string;

      if (parsed.data.password !== undefined) {
        const { error } = await db.rpc("swamp_set_share_password", {
          p_view_id: params.id,
          p_password: parsed.data.password || null,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }

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
