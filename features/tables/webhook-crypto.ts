import { createHmac, timingSafeEqual } from "node:crypto";

// ════════════════════════════════════════════════════════════════════════════
// The three pure decisions a webhook delivery makes.
//
// Kept out of the dispatcher, and out of `server-only`, because each of them is
// a thing you want to be able to test without a database, a network, or a clock:
//
//   sign()             — can the receiver prove this came from us?
//   isPrivateAddress() — are we about to fetch a URL we shouldn't?
//   backoffMs()        — when do we try again?
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sign the payload.
 *
 * The timestamp is INSIDE the signed string, not merely alongside it. Sign the
 * body alone and an attacker who captures one delivery can replay it forever —
 * the signature stays valid because the body never changed. With the timestamp
 * signed, a receiver can reject anything older than a few minutes, and a replay
 * requires forging a signature over a timestamp the attacker chose, which is the
 * thing they cannot do.
 *
 * The format is `sha256=<hex>` over `<timestamp>.<body>`, which is the same shape
 * Stripe and GitHub use — not because it is the only correct one, but because a
 * receiver's engineer has almost certainly implemented it before.
 */
export function sign(secret: string, timestamp: string, body: string): string {
  return (
    "sha256=" +
    createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
  );
}

/**
 * Verify a signature. Exported because the receiver's side of this is the part
 * people get wrong, and now there is a reference implementation in the repo.
 *
 * `timingSafeEqual`, not `===`. A string compare returns as soon as it finds a
 * differing byte, so how long it took tells you how many leading bytes you got
 * right — and an attacker who can measure that can find the signature one byte at
 * a time instead of guessing all thirty-two.
 */
export function verify(
  secret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const expected = Buffer.from(sign(secret, timestamp, body));
  const given = Buffer.from(signature);

  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Is this address one we must refuse to fetch?
 *
 * A webhook is a URL, chosen by a user, that OUR SERVER fetches. That is the exact
 * shape of an SSRF: the user cannot reach `169.254.169.254` (the cloud metadata
 * endpoint, which will happily hand out credentials) or `10.0.0.x` (whatever else
 * we run) — but our server can, and a webhook asks it to.
 *
 * So the check happens against the RESOLVED ADDRESS, not the hostname. A hostname
 * check alone is defeated by a DNS record that points at 127.0.0.1, and people do
 * exactly that.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.split(".").map(Number);

  if (v4.length === 4 && v4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = v4;

    if (a === 10) return true; // 10/8      private
    if (a === 127) return true; // 127/8     loopback
    if (a === 0) return true; // 0/8       "this network"
    if (a === 169 && b === 254) return true; // 169.254/16 link-local — the metadata endpoint
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a >= 224) return true; // multicast, reserved

    return false;
  }

  const v6 = ip.toLowerCase();

  if (v6 === "::1" || v6 === "::") return true; // loopback, unspecified
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique-local
  if (/^fe[89ab]/.test(v6)) return true; // link-local fe80::/10 (fe80–febf), not just /16

  // ::ffff:127.0.0.1 — an IPv4 address wearing an IPv6 hat. Miss this and the
  // whole check above is decorative.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);

  return false;
}

/**
 * How long to wait before the next attempt.
 *
 * 1m, 5m, 25m, 2h, 6h — then dead. Growing, because a receiver that is down is
 * usually down for a while, and hammering it every ten seconds helps nobody. And
 * bounded at five, because a webhook that has failed five times over eight hours
 * is not going to succeed on the sixth: it is misconfigured, and the honest thing
 * is to mark it dead and show it in the log.
 */
export const MAX_ATTEMPTS = 5;

export function backoffMs(attempts: number): number {
  const minutes = [1, 5, 25, 120, 360];
  return minutes[Math.min(attempts, minutes.length) - 1] * 60_000;
}
