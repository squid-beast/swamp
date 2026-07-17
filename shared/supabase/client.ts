import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_* vars are inlined at build time, so a missing one fails the build
// rather than shipping an app that silently runs without auth.
//
// `present()` exists because an env var set to the empty string is not set, and
// `??` doesn't know that — a bare `KEY=` in a .env would defeat the fallback.
const present = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

const url = present(process.env.NEXT_PUBLIC_SUPABASE_URL);
const key =
  present(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
  present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

if (!url || !key) {
  throw new Error(
    "[swamp] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
      "See .env.local.example. There is no unauthenticated mode."
  );
}

// Narrowed above; re-bound so the types survive into the closure below.
const SUPABASE_URL: string = url;
const SUPABASE_KEY: string = key;

// One client per tab, not one per call.
//
// Realtime needs the socket to carry the user's JWT (postgres_changes is RLS-gated
// and delivers nothing to an anonymous socket). A fresh client per createClient()
// call meant every hook opened its own socket and its own auth listener, racing to
// hydrate the session from cookies. A singleton loads the session once and every
// channel — records, comments — rides the same authenticated connection.
let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  return (client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY));
}
