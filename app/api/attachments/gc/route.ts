import { NextRequest, NextResponse } from "next/server";
import { collectGarbage } from "@/features/tables/attachments";
import { cronDenied, createServiceClient } from "@/shared/supabase/admin";

// POST /api/attachments/gc
//
// Deletes files nothing points at, after a grace period. Cron nightly; by hand
// while testing:
//
//   curl -X POST "localhost:3000/api/attachments/gc?graceHours=0" \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// `?graceHours=0` exists so the behaviour can be tested without waiting a day.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = cronDenied(req);
  if (denied) return denied;

  const raw = req.nextUrl.searchParams.get("graceHours");
  const grace = raw == null ? 24 : Math.max(0, Number(raw));

  if (!Number.isFinite(grace)) {
    return NextResponse.json({ error: "graceHours must be a number" }, { status: 400 });
  }

  const result = await collectGarbage(createServiceClient(), grace);
  return NextResponse.json(result);
}
