import "server-only";
import { createHash } from "crypto";
import { createPublicClient } from "@/shared/supabase/public";

// ════════════════════════════════════════════════════════════════════════════
// Rate limiting for the public ingress.
//
// A thin call over swamp_rate_limit — the counting is in the database, because
// the app is many short-lived serverless functions with no shared memory, and an
// in-process counter on that shape counts to one per cold start. See the
// 20260717010000 migration.
//
// Fail OPEN. If the limiter itself errors, the request proceeds: a rate limit is
// a guard rail, not the security boundary (that is RLS and the token functions),
// and taking the whole ingress down because the counter table hiccuped would be a
// worse outage than the abuse it exists to slow.
// ════════════════════════════════════════════════════════════════════════════

/** Hash anything that might be a secret before it becomes a bucket key. A token
 *  must not sit in the rate_limits table in the clear. */
function key(...parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex");
}

/** The caller's IP, best effort, from the proxy headers Vercel sets. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Count one hit. Returns true if allowed, false if over the limit.
 *
 * `bucket` is any stable string that identifies the actor; it is hashed here, so
 * pass the token or the IP directly and don't worry about it landing in a table.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const { data, error } = await createPublicClient().rpc("swamp_rate_limit", {
      p_key: key(bucket),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return true; // fail open
    return data !== false;
  } catch {
    return true; // fail open
  }
}

/** The 429 body, with a Retry-After the client can honour. */
export function tooMany(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "rate limit exceeded — slow down" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}

// Sensible defaults for the two public write paths. Generous enough that a real
// integration never notices, tight enough that a script cannot flood a table.
export const V1_WRITE_LIMIT = 120; // per token, per minute
export const FORM_SUBMIT_LIMIT = 20; // per IP + form, per minute
export const WINDOW_SECONDS = 60;
