import { NextRequest, NextResponse } from "next/server";
import { dispatchPending } from "@/features/tables/webhooks";
import { cronDenied, createServiceClient } from "@/shared/supabase/admin";

// POST /api/webhooks/dispatch
//
// Delivers whatever is due. Called by the cron every minute, and by hand while you
// are testing:
//
//   curl -X POST localhost:3000/api/webhooks/dispatch \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// Service role, because there is no user here: the job delivers events on behalf of
// the system, across every base, and there is no session it could possibly run as.
// It takes no ids from the caller — the only thing it can do is send what the
// triggers already queued.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = cronDenied(req);
  if (denied) return denied;

  const result = await dispatchPending(createServiceClient());
  return NextResponse.json(result);
}
