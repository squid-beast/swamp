import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

// Cookie-bound server client for Server Components, Route Handlers, and the
// middleware session refresh (@supabase/ssr, Next 14 App Router).
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // called from a Server Component — safe to ignore; middleware refreshes.
        }
      },
    },
  });
}

// Returns the signed-in user's id, or null. The single place routes get identity.
export async function getUserId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Route guard. Null = allowed; otherwise a 401 to return.
//
// There is no bypass. A misconfigured environment throws at import time (see
// ./env), so this can never silently fall through to "allowed".
export async function requireAuth(): Promise<NextResponse | null> {
  const uid = await getUserId();
  if (!uid) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return null;
}
