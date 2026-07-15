import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SUPABASE_URL } from "./env";

// ════════════════════════════════════════════════════════════════════════════
// The service role. Read this before you import it.
//
// A service-role client BYPASSES RLS ENTIRELY. It is not "an admin user" — it is
// no user at all, with every policy switched off. Every guarantee the rest of
// this codebase makes about who can see what evaporates on a connection opened
// with this key.
//
// It is legitimate in exactly one situation: a background job with no user
// session, acting on behalf of the system rather than a person. Two exist:
//
//   • /api/sync             — the Google Sheets poller
//   • /api/webhooks/dispatch — delivering queued webhooks
//   • /api/attachments/gc    — deleting orphaned files
//
// All three are gated on CRON_SECRET, none of them takes a table id from the
// caller, and none of them is reachable from a browser. If you find yourself
// reaching for this key in a route that a user hits, the answer is a SECURITY
// DEFINER function, not this.
// ════════════════════════════════════════════════════════════════════════════

export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("[swamp] SUPABASE_SERVICE_ROLE_KEY is not set");

  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Guard for a cron route. Null = allowed.
 *
 * A missing CRON_SECRET denies rather than allows. The other way round is how an
 * unconfigured environment ends up with a publicly callable job that holds the
 * service key.
 */
export function cronDenied(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return null;
}
