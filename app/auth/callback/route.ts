import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/supabase/server";

// OAuth (Google) + email-confirmation return. Exchanges the code for a session,
// captures the Google refresh token (for offline Sheets reads) when present,
// then continues to ?next (defaults to /app).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/auth/sign-in?error=${encodeURIComponent(error.message)}`);
    }
    const refresh = data.session?.provider_refresh_token;
    const userId = data.session?.user?.id;
    if (refresh && userId) {
      // Persist the Google refresh token so the poller can read the sheet later.
      await supabase.from("google_credentials").upsert({
        user_id: userId,
        refresh_token: refresh,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
