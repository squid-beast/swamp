import { NextRequest, NextResponse } from "next/server";
import { syncAllConnections } from "@/features/sheets/sync-service";
import { cronDenied, createServiceClient } from "@/shared/supabase/admin";

// Re-sync every connected sheet. Reachable two ways: the daily fan-out at
// /api/cron, and by hand while testing:
//
//   curl "localhost:3000/api/sync" -H "Authorization: Bearer $CRON_SECRET"
//
// Service role, because a cron invocation has no user session for RLS to scope
// to. The loop itself lives in features/sheets/sync-service.ts so /api/cron can
// run it without going through HTTP.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = cronDenied(req);
  if (denied) return denied;

  const result = await syncAllConnections(createServiceClient());
  return NextResponse.json(result);
}

export const POST = GET;
