import { NextRequest, NextResponse } from "next/server";
import { createToken, listTokens } from "@/features/tables/api-tokens";
import { createTokenSchema } from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  return NextResponse.json({ tokens: await listTokens(params.id) });
}

/**
 * Mint a token.
 *
 * The response contains the plaintext, and it is the only time it will. Nothing
 * on the server keeps a copy — the database stores a SHA-256 of it and the
 * plaintext is gone the moment this response is written.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = createTokenSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const { name, scopes, expiresAt, tableIds } = parsed.data;
    const created = await createToken(params.id, name, scopes, expiresAt ?? null, tableIds ?? []);

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    // RLS refuses a token for a base you cannot reach.
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
