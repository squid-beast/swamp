import "server-only";
import { createHash } from "crypto";
import { createPublicClient } from "@/shared/supabase/public";

// ════════════════════════════════════════════════════════════════════════════
// Idempotency for the public ingress.
//
// A thin call over swamp_idempotency_claim / _finish — the store is in the
// database because the app is many short-lived serverless functions with no
// shared memory, so an in-process map cannot dedupe a retry that lands on a
// different instance. See the 20260721000000 migration.
//
// Fail OPEN, like the rate limiter: if the claim itself errors, the request
// proceeds (treated as `new`). Idempotency is a convenience for retry-safety,
// not the security boundary (that is RLS and the token functions), and taking
// the ingress down because the bookkeeping table hiccuped would be worse than a
// duplicate lead once in a blue moon.
// ════════════════════════════════════════════════════════════════════════════

/** 24h — long enough to cover any transport retry, short enough that the store
 *  stays small. Enforced by passing it to the SQL, which purges past it. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export type ClaimResult =
  | { status: "new" }
  | { status: "in_flight" }
  | { status: "done"; response: unknown };

/** Hash the bucket before it becomes a store key. The raw token is part of the
 *  bucket and must not sit in a table in the clear — same approach as rate-limit. */
function key(bucket: string): string {
  return createHash("sha256").update(bucket).digest("hex");
}

/**
 * Claim a bucket for this request.
 *
 * `new`       — first time we've seen this key; proceed and call finish() after.
 * `done`      — a previous request already completed; replay `response`.
 * `in_flight` — a concurrent duplicate is still running; the route answers 409.
 */
export async function claim(
  bucket: string,
  ttlSeconds: number = IDEMPOTENCY_TTL_SECONDS
): Promise<ClaimResult> {
  try {
    const { data, error } = await createPublicClient().rpc("swamp_idempotency_claim", {
      p_key: key(bucket),
      p_ttl_seconds: ttlSeconds,
    });
    if (error || !data) return { status: "new" }; // fail open
    return data as ClaimResult;
  } catch {
    return { status: "new" }; // fail open
  }
}

/** Store the final response body so a later retry replays it. Best effort:
 *  errors are swallowed, since a lost record only costs one un-deduped retry. */
export async function finish(bucket: string, response: unknown): Promise<void> {
  try {
    await createPublicClient().rpc("swamp_idempotency_finish", {
      p_key: key(bucket),
      p_response: response,
    });
  } catch {
    // best effort
  }
}
