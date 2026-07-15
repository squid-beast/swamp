import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/**
 * A stateless anon client. No cookies, no session, no service key.
 *
 * This is what the public REST API runs on. It matters: a request that arrives
 * with an API token gets a database connection with **no ambient authority at
 * all**. Everything it can do, it can do because a SECURITY DEFINER function
 * looked at the token and decided so.
 *
 * The alternative — handing the REST API a service-role client and checking
 * permissions in TypeScript — puts the entire security model in a route handler,
 * one forgotten `if` away from being no security model.
 */
export function createPublicClient() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
