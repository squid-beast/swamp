import { NextRequest, NextResponse } from "next/server";
import { listHistory } from "@/features/tables/collaboration";
import { requireAuth } from "@/shared/supabase/server";

// A record's history: who changed what, field by field.
//
// Read-only, for everyone — `record_audit` has no insert, update or delete policy
// at all. The only thing that writes it is a SECURITY DEFINER trigger. An audit log
// its subject can edit is not an audit log.

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json({ history: await listHistory(params.id) });
}
