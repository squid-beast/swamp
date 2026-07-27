import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  inviteToBase,
  listInvites,
  listMembers,
  removeMember,
  setMemberRole,
} from "@/features/tables/collaboration";
import { createClient, getUserId, requireAuth } from "@/shared/supabase/server";
import { sendEmail } from "@/shared/email/send";
import { inviteEmail } from "@/shared/email/templates";
import { absolute } from "@/shared/seo/site";

// Members of a base, and pending invites.
//
// Everything here is gated at CREATOR by RLS — and there's a second rule in the
// policy that's worth knowing about: you cannot invite someone at a role ABOVE
// your own. Without it, an editor invites themselves back as an owner from a
// second email address.

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const [members, invites] = await Promise.all([
    listMembers(params.id),
    listInvites(params.id).catch(() => []), // a viewer can see members, not invites
  ]);

  return NextResponse.json({ members, invites });
}

const roleSchema = z.enum(["viewer", "commenter", "editor", "creator", "owner"]);

const postSchema = z.object({
  email: z.string().email(),
  role: roleSchema.default("editor"),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const userId = await getUserId();

  try {
    const invite = await inviteToBase(
      params.id,
      parsed.data.email,
      parsed.data.role,
      userId!
    );

    // Email the invite — best-effort. The invite is already valid (its row exists),
    // and the panel still shows a copyable link, so a mail failure must not fail
    // this request. Fetch the base name for a friendlier subject; if that read
    // fails, the email just says "a workspace".
    const { data: base } = await createClient()
      .from("bases")
      .select("name")
      .eq("id", params.id)
      .maybeSingle();

    const { subject, html, text } = inviteEmail({
      url: absolute(`/invite/${invite.token}`),
      role: invite.role,
      baseName: (base?.name as string) ?? null,
    });

    void sendEmail({ to: invite.email, subject, html, text }).catch(() => {});

    return NextResponse.json({ invite });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

const patchSchema = z.object({
  userId: z.string().uuid(),
  role: roleSchema,
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await setMemberRole(params.id, parsed.data.userId, parsed.data.role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

const deleteSchema = z.object({ userId: z.string().uuid() });

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = deleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await removeMember(params.id, parsed.data.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
