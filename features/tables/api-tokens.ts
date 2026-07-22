import "server-only";
import { createClient } from "@/shared/supabase/server";
import type { ApiToken, TokenScope } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// API tokens — the owner's side.
//
// The token itself is minted in the database (swamp_create_token) and returned
// exactly once. Nothing here can recover it, and that is the feature: the only
// copy of a SWAMP token that exists anywhere is the one the user copied.
//
// "I lost my token" has one answer. It is "make another one", and any product
// that has a better answer than that is storing your token in plaintext.
// ════════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

const toToken = (r: Row): ApiToken => ({
  id: r.id as string,
  baseId: r.base_id as string,
  userId: r.user_id as string,
  name: r.name as string,
  prefix: r.prefix as string,
  scopes: (r.scopes as TokenScope[]) ?? [],
  tableIds: (r.table_ids as string[]) ?? [],
  expiresAt: (r.expires_at as string) ?? null,
  lastUsedAt: (r.last_used_at as string) ?? null,
  revokedAt: (r.revoked_at as string) ?? null,
  createdAt: r.created_at as string,
});

/** Your tokens for this base. Never anyone else's — see the RLS policy. */
export async function listTokens(baseId: string): Promise<ApiToken[]> {
  const { data, error } = await createClient()
    .from("api_tokens")
    .select("id, base_id, user_id, name, prefix, scopes, table_ids, expires_at, last_used_at, revoked_at, created_at")
    .eq("base_id", baseId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listTokens: ${error.message}`);
  return (data ?? []).map(toToken);
}

/** Returns the plaintext. This is the only moment it exists outside the caller's
 *  clipboard, so the route must hand it straight to the user and keep no copy.
 *
 *  `tableIds` empty = every table in the base. A non-empty list pins the token to
 *  those tables, so a lead-ingest key can write to Leads and reach nothing else. */
export async function createToken(
  baseId: string,
  name: string,
  scopes: TokenScope[],
  expiresAt: string | null,
  tableIds: string[] = []
): Promise<{ id: string; token: string }> {
  const { data, error } = await createClient().rpc("swamp_create_token", {
    p_base_id: baseId,
    p_name: name,
    p_scopes: scopes,
    p_expires_at: expiresAt,
    p_table_ids: tableIds,
  });

  if (error) throw new Error(error.message);
  return data as { id: string; token: string };
}

/**
 * Revoke, don't delete.
 *
 * A deleted token leaves no trace that it ever existed, which is precisely the
 * question you want answered after an incident: what was this thing, who made it,
 * what could it reach, and when did it last run? `revoked_at` kills it instantly
 * — swamp_token_context checks it on every call — and keeps the record.
 */
export async function revokeToken(id: string): Promise<void> {
  const { error } = await createClient()
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`revokeToken: ${error.message}`);
}
