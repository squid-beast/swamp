import { NextRequest, NextResponse } from "next/server";
import { dispatchPending } from "@/features/tables/webhooks";
import { collectGarbage } from "@/features/tables/attachments";
import { syncAllConnections } from "@/features/sheets/sync-service";
import { cronDenied, createServiceClient } from "@/shared/supabase/admin";

// The daily fan-out. Vercel Hobby allows two cron entries at one run per day —
// this route spends ONE entry on all three jobs so the count stops being a
// design constraint.
//
// Order matters: sheet sync is the only unbounded job (a Google token refresh
// plus a full sheet read per connection), so it runs LAST — a 60s kill leaves
// webhook dispatch and attachment GC already committed.
//
// Each job gets its own try/catch: a failure in one is reported, not fatal to
// the rest. By hand:
//
//   curl "localhost:3000/api/cron" -H "Authorization: Bearer $CRON_SECRET"

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = cronDenied(req);
  if (denied) return denied;

  const db = createServiceClient();
  const results: Record<string, unknown> = {};

  try {
    results.webhooks = await dispatchPending(db);
  } catch (e) {
    results.webhooks = { error: (e as Error).message };
  }

  try {
    results.attachments = await collectGarbage(db, 24);
  } catch (e) {
    results.attachments = { error: (e as Error).message };
  }

  try {
    results.sheets = await syncAllConnections(db);
  } catch (e) {
    results.sheets = { error: (e as Error).message };
  }

  return NextResponse.json(results);
}

export const POST = GET;
