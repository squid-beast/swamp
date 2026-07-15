// ── Supabase environment. Fail loud, fail at boot. ──
//
// This module used to export an `isSupabaseConfigured` flag, and callers treated
// a false value as "run open" — no auth, local file store. That meant a single
// missing env var in production silently disabled every guard in the app.
//
// There is no "open" mode any more. Missing config is a boot failure.

/**
 * An env var set to the empty string is *not* set. `??` doesn't know that — it
 * only falls through on null/undefined — so `KEY_A ?? KEY_B` would return ""
 * when a .env file contains a bare `KEY_A=`, silently defeating the fallback.
 */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function required(name: string, value: string | undefined): string {
  const found = present(value);
  if (!found) {
    throw new Error(
      `[swamp] Missing required environment variable: ${name}. ` +
        `Set it in .env.local (see .env.local.example). The app will not start without it.`
    );
  }
  return found;
}

export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

export const SUPABASE_KEY = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
  present(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);
