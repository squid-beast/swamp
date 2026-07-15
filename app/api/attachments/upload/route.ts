import { NextRequest, NextResponse } from "next/server";
import { requestUpload } from "@/features/tables/attachments";
import { uploadRequestSchema } from "@/features/tables/schema";
import { requireAuth } from "@/shared/supabase/server";

// POST /api/attachments/upload
//
// Returns a signed URL the browser uploads to DIRECTLY. The file does not pass
// through this server — a 50MB upload through a route handler is 50MB of memory
// and a request that times out somewhere in the middle.
//
// The path is chosen HERE, prefixed with the base id, because the storage policy
// reads that prefix to decide who may write. A client-chosen path is a
// client-chosen base.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = uploadRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { tableId, fieldId, name, size, mime } = parsed.data;

  try {
    const ticket = await requestUpload(
      tableId,
      fieldId,
      name,
      size,
      mime ?? "application/octet-stream"
    );

    return NextResponse.json(ticket);
  } catch (e) {
    // The storage policy refuses a viewer. So does the file_references policy.
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
