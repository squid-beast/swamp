import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/supabase/server";

// OAuth (Google) + email-confirmation return. Exchanges the code for a session,
// captures the Google refresh token (for offline Sheets reads) when present,
// then continues to ?next (defaults to /app).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  // Supabase bounces back here with ?error=... when the provider config is wrong or
  // the new-user step fails ("server_error"). Surface it on the sign-in page instead
  // of silently forwarding to /app, where middleware would just bounce the visitor
  // back with no explanation — which reads as "login is broken".
  const providerError = searchParams.get("error_description") || searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/auth/sign-in?error=${encodeURIComponent(providerError)}`
    );
  }

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/auth/sign-in?error=${encodeURIComponent(error.message)}`);
    }
    const refresh = data.session?.provider_refresh_token;
    const userId = data.session?.user?.id;
    if (refresh && userId) {
      // Best-effort: persist the Google refresh token for the Sheets poller. A
      // failure here must never block sign-in, so its result is ignored.
      await supabase.from("google_credentials").upsert({
        user_id: userId,
        refresh_token: refresh,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
