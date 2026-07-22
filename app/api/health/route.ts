import { NextResponse } from "next/server";
import { createClient } from "@/shared/supabase/server";

// Is it up? One curl, one answer.
//
//   curl -sS https://www.swampy.app/api/health
//
// 200 = env present and the database answered. 503 = `checks` says which half failed.
//
// It never returns a variable's VALUE — only whether it is set. The point is to tell a
// misconfiguration from an outage, and that needs a boolean, not a secret.

export const dynamic = "force-dynamic";

/** Set-but-empty is not set — the same rule shared/supabase/env.ts applies. */
const isSet = (v: string | undefined) => Boolean(v?.trim());

export async function GET() {
  // ── Build-time vars ──
  //
  // NEXT_PUBLIC_* are substituted into the bundle by webpack's DefinePlugin when the
  // app is COMPILED, so these booleans describe the build, not this machine. If one
  // were missing, `next build` would have thrown at shared/supabase/env.ts and there
  // would be no deployment to ask.
  //
  // Which is exactly what §6 missed: it read middleware.ts's `throw new Error(...)` as
  // a runtime hazard that could 503 a live app. It cannot. It is unreachable code in a
  // built app, and its absence fails the build instead. These will read `true` on any
  // deployment that exists — that IS the finding, so they are reported rather than
  // assumed.
  const build = {
    NEXT_PUBLIC_SUPABASE_URL: isSet(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_KEY:
      isSet(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
      isSet(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };

  // ── Runtime vars ──
  //
  // These are read from the environment on each invocation, so unlike the block above
  // they can genuinely be missing on a deployment that built fine. This is where a real
  // config fault lives. None of them are needed to serve the app — each disables one
  // feature — so a missing one is reported, not fatal.
  const runtime = {
    SUPABASE_SERVICE_ROLE_KEY: isSet(process.env.SUPABASE_SERVICE_ROLE_KEY), // cron, webhook dispatch
    RESEND_API_KEY: isSet(process.env.RESEND_API_KEY), // invite + share email
    CRON_SECRET: isSet(process.env.CRON_SECRET), // authenticates the webhook retry cron
    GOOGLE_CLIENT_ID: isSet(process.env.GOOGLE_CLIENT_ID), // Sheets sync
    GOOGLE_CLIENT_SECRET: isSet(process.env.GOOGLE_CLIENT_SECRET),
  };

  // ── The database ──
  //
  // swamp_health() takes nothing and returns 'ok'. If this resolves, Postgres parsed,
  // executed, and replied. See supabase/migrations/20260716080000_health.sql.
  let database: "ok" | "unreachable" = "unreachable";
  let databaseError: string | undefined;

  try {
    const { data, error } = await createClient().rpc("swamp_health");
    if (error) {
      // The message, not the whole error object: the latter can carry connection
      // details, and this endpoint is public.
      databaseError = error.message;
    } else if (data === "ok") {
      database = "ok";
    } else {
      databaseError = `unexpected reply: ${JSON.stringify(data)}`;
    }
  } catch (e) {
    databaseError = (e as Error).message;
  }

  const healthy = database === "ok" && build.NEXT_PUBLIC_SUPABASE_URL && build.NEXT_PUBLIC_SUPABASE_KEY;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: { database, ...(databaseError ? { databaseError } : {}), build, runtime },
      // Which deploy answered. Turns "it's broken" into "it's broken on THIS commit".
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      time: new Date().toISOString(),
    },
    {
      // 503 is the honest code for "this instance cannot serve": it is what a load
      // balancer and an uptime check both read as down. Note the irony, and that it is
      // deliberate — this is now the ONLY thing in the codebase that can emit a 503,
      // which is precisely why §6's story never held up.
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    }
  );
}
