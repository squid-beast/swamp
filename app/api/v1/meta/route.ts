import { NextRequest, NextResponse } from "next/server";
import { apiError, apiMeta, bearer } from "@/features/tables/rest";
import { preflight, withCors } from "@/features/tables/cors";

// GET /api/v1/meta
//
// The first call any integration makes. It returns the base, its tables, and the
// KEY of every field — because `fields` is keyed by key, not by name, and this is
// where you learn them.
//
// It also answers "what may this token do", implicitly: if it 401s, the token is
// dead, and you found out in one request instead of debugging a write.

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const token = bearer(req);
  if (!token) {
    return withCors(
      NextResponse.json(
        { error: "Missing token. Send: Authorization: Bearer <token>" },
        { status: 401 }
      ),
      origin
    );
  }

  try {
    return withCors(NextResponse.json(await apiMeta(token)), origin);
  } catch (e) {
    return withCors(apiError(e), origin);
  }
}
