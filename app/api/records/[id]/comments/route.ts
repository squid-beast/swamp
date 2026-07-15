import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addComment, listComments } from "@/features/tables/collaboration";
import { createClient, getUserId, requireAuth } from "@/shared/supabase/server";

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
    return NextResponse.json({ comments: await listComments(params.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
