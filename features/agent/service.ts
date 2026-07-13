// ── Agent API plumbing: secret auth + service-role Supabase client. ──────────
// Cloud agents (Claude) call /api/agent/* with `Authorization: Bearer <AGENT_API_SECRET>`.
// Writes are attributed to the owner resolved from AGENT_OWNER_EMAIL, using the
// service-role key (server-only). Same trust model as the cron sync, but simpler:
// one secret in, one owner out. No UI, no session, no cookies.

import { createClient as createServiceClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export function agentDenied(req: NextRequest): NextResponse | null {
  const secret = process.env.AGENT_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "AGENT_API_SECRET not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export function serviceDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY / URL not configured");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

// Resolve the human the agent works for. One owner per deployment.
export async function agentOwnerId(db: SupabaseClient): Promise<string> {
  const email = process.env.AGENT_OWNER_EMAIL;
  if (!email) throw new Error("AGENT_OWNER_EMAIL not configured");
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`no profile found for AGENT_OWNER_EMAIL=${email}`);
  return data.id as string;
}

export function jsonError(e: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: (e as Error).message ?? String(e) }, { status });
}

// Stable slug for natural-key row ids (business name + phone digits).
export function slugKey(...parts: (string | undefined | null)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
