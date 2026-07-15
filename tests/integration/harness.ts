import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// ── Integration harness. ──
//
// These tests run against the LOCAL Supabase stack (`supabase start`). They are
// the only way to prove RLS does what the policies claim — you cannot unit-test
// a security boundary that lives in the database.
//
// Rules, per tests/README.md:
//   • No seed data. Every test creates what it needs and tears it down.
//   • Users are throwaway. Deleting a user cascades away everything they own.
//   • This never runs against a hosted project. See assertLocal().

const BASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "http://127.0.0.1:54321";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Refuse to run against anything that isn't localhost.
 *
 * This suite creates users and DELETES them with the service-role key. Pointed
 * at a hosted project that's a data-loss event, and the only thing between the
 * two is an environment variable. So check it, loudly, before doing anything.
 */
function assertLocal(url: string): void {
  const { hostname } = new URL(url);
  const isLocal =
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "0.0.0.0";
  if (!isLocal) {
    throw new Error(
      `[swamp] Integration tests are pointed at ${url}.\n` +
        `They create and DELETE users with the service-role key, and must only ever\n` +
        `run against the local stack. Fix NEXT_PUBLIC_SUPABASE_URL in .env.local.`
    );
  }
}

function env(): { url: string; serviceKey: string; anonKey: string } {
  if (!SERVICE_KEY || !ANON_KEY) {
    throw new Error(
      "[swamp] Integration tests need SUPABASE_SERVICE_ROLE_KEY and a publishable/anon key\n" +
        "in .env.local. Run `supabase status` and copy them in."
    );
  }
  assertLocal(BASE_URL);
  return { url: BASE_URL, serviceKey: SERVICE_KEY, anonKey: ANON_KEY };
}

/** Service-role client. Bypasses RLS. Used ONLY to create and destroy users. */
export function admin(): SupabaseClient {
  const { url, serviceKey } = env();
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * A signed-OUT client — no session, no user, no authority whatsoever.
 *
 * This is exactly what the public REST API runs on, and what an anonymous visitor
 * to a share link runs on. Anything reachable through this client is reachable by
 * the internet, so it is the right thing to point at a policy and try.
 */
export function anon(): SupabaseClient {
  const { url, anonKey } = env();
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  /** An RLS-scoped client signed in as this user. Tests assert through this. */
  db: SupabaseClient;
}

/**
 * Create a throwaway user and return a client signed in as them.
 *
 * The signup trigger gives every user a workspace, so they can immediately
 * create a base. That's a schema invariant, not seed data.
 */
export async function createUser(): Promise<TestUser> {
  const { url, anonKey } = env();

  const email = `test-${randomUUID()}@swamp.test`;
  const password = randomUUID();

  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);

  const db = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);

  return { id: data.user!.id, email, db };
}

/** Delete a user. Everything they own cascades away with them. */
export async function deleteUser(user: TestUser | undefined): Promise<void> {
  if (!user) return;
  await admin().auth.admin.deleteUser(user.id);
}

/** The workspace the signup trigger created for this user. */
export async function workspaceOf(user: TestUser): Promise<string> {
  const { data, error } = await user.db.from("workspace_members").select("workspace_id");
  if (error) throw new Error(`workspaceOf failed: ${error.message}`);
  if (!data?.length) {
    throw new Error("user has no workspace — the signup bootstrap trigger did not fire");
  }
  return data[0].workspace_id as string;
}

/**
 * Unwrap a PostgREST result, throwing on error.
 * For ARRANGE steps only — never wrap the thing you're asserting on.
 */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
