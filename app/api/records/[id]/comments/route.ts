import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addComment, extractMentions, listComments } from "@/features/tables/collaboration";
import { createClient, getUserId, requireAuth } from "@/shared/supabase/server";
import { sendEmail } from "@/shared/email/send";
import { SITE } from "@/shared/seo/site";

// Comments on one record.
//
// Posting is gated at COMMENTER in RLS — the role exists precisely for this:
// someone who should be able to say "this looks wrong" without being able to
// change it.

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json({ comments: await listComments(params.id) });
}

const schema = z.object({ body: z.string().trim().min(1).max(10000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const userId = await getUserId();

  // The record tells us its base and table. Taking those from the client instead
  // would let someone post a comment scoped to a base they can read onto a record
  // in one they can't.
  const { data: record } = await createClient()
    .from("records")
    .select("base_id, table_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await addComment(
      record.base_id,
      record.table_id,
      params.id,
      userId!,
      parsed.data.body
    );

    // Mention email — from HERE, not a DB trigger (Postgres can't send mail) and
    // not the daily cron (a mention delivered tomorrow is an insult). Best-effort
    // by sendEmail's own contract: no RESEND_API_KEY ⇒ silently skipped; the
    // in-app notification (the mention trigger) is the reliable channel.
    const mentioned = extractMentions(parsed.data.body).filter((id) => id !== userId);
    if (mentioned.length) {
      void createClient()
        .rpc("swamp_visible_profiles", { p_user_ids: mentioned })
        .then(({ data }) => {
          const url = `${SITE.url}/app/t/${record.table_id}?record=${params.id}`;
          const snippet = parsed.data.body.slice(0, 200);
          for (const p of (data as { email: string | null }[] | null) ?? []) {
            if (!p.email) continue;
            void sendEmail({
              to: p.email,
              subject: "You were mentioned in Swamp",
              text: `${snippet}\n\n${url}`,
              html: `<p>${snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p><p><a href="${url}">Open the record</a></p>`,
            });
          }
        });
    }

    return NextResponse.json({ comments: await listComments(params.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
