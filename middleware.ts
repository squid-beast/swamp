import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// An env var set to the empty string is not set; `??` doesn't know that.
const present = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

const url = present(process.env.NEXT_PUBLIC_SUPABASE_URL);
const key =
  present(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
  present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

if (!url || !key) {
  // Fail at boot, not at request time. A missing env var must never degrade
  // into "let everyone through" — which is exactly what this used to do.
  throw new Error(
    "[swamp] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
      "See .env.local.example. There is no unauthenticated mode."
  );
}

// Narrowed above; re-bound so the types survive into the handler below.
const SUPABASE_URL: string = url;
const SUPABASE_KEY: string = key;

// Refresh the Supabase session on every matched request and gate the app.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]
      ) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as never)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const inApp = path.startsWith("/app");
  const inAuth = path === "/auth/sign-in" || path === "/auth/register";

  if (!user && inApp) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && inAuth) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/auth/sign-in", "/auth/register"],
};
