import { createBrowserClient } from "@supabase/ssr";

// New-style publishable key (falls back to the legacy anon key name).
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// True only once the Supabase env is present. Guards the UI so the auth screens
// render (and degrade gracefully) before the project is wired.
export const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!SUPABASE_KEY;

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, SUPABASE_KEY!);
}
