import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/supabase/server";
import { SHEETS_SCOPE, fetchGrantedScope, hasSheetsScope } from "@/features/sheets/google/sheets";

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
      // google_credentials is Sheets-only. A plain Google sign-in grants no Sheets
      // scope and must NOT write here — doing so used to overwrite a good Sheets
      // token with a useless one (or create a bogus "connected" row that 403s on the
      // first Load tabs). Ask Google what the token can actually do; fall back to the
      // connect flow's requested scope if Google won't say. Store only if it's real.
      const providerToken = data.session?.provider_token;
      let scope = providerToken ? await fetchGrantedScope(providerToken) : "";
      if (!scope && next.startsWith("/app/connect")) scope = SHEETS_SCOPE;

      if (hasSheetsScope(scope)) {
        // Best-effort: a failure here must never block sign-in, so its result is
        // ignored.
        await supabase.from("google_credentials").upsert({
          user_id: userId,
          refresh_token: refresh,
          scope,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
