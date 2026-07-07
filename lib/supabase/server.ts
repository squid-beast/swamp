import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!SUPABASE_KEY;

// Cookie-bound server client for Server Components, Route Handlers, and the
// middleware session refresh (@supabase/ssr, Next 14 App Router).
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SUPABASE_KEY!,
    {
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
    }
  );
}

// Returns the signed-in user's id, or null. The single place routes get identity.
export async function getUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Route guard. Null = allowed; otherwise a 401 to return. In local FileStore
// mode (no Supabase) the app runs open, so this is a no-op.
export async function requireAuth(): Promise<NextResponse | null> {
  if (!isSupabaseConfigured) return null;
  const uid = await getUserId();
  if (!uid) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return null;
}
