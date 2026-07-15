import { describe, expect, it } from "vitest";
import {
  backoffMs,
  isPrivateAddress,
  MAX_ATTEMPTS,
  sign,
  verify,
} from "@/features/tables/webhook-crypto";

// ════════════════════════════════════════════════════════════════════════════
// The three pure decisions a webhook delivery makes.
//
// All three are the kind of code that looks obviously right and is quietly wrong,
// and none of them fails loudly when it is: a replayable signature works, an SSRF
// works, and a bad backoff just means somebody else's server gets hammered.
// ════════════════════════════════════════════════════════════════════════════

describe("signing", () => {
  it("round-trips", () => {
    const body = JSON.stringify({ event: "record.created" });
    expect(verify("s3cret", "1700000000", body, sign("s3cret", "1700000000", body))).toBe(true);
  });

  it("fails on a different secret", () => {
    const body = "{}";
    const signature = sign("right", "1700000000", body);
    expect(verify("wrong", "1700000000", body, signature)).toBe(false);
  });

  it("fails when the body was tampered with", () => {
    const signature = sign("s", "1700000000", '{"amount":10}');
    expect(verify("s", "1700000000", '{"amount":1000000}', signature)).toBe(false);
  });

  it("REJECTS A REPLAY — the timestamp is inside the signed string", () => {
    // This is the whole reason the timestamp is signed rather than merely sent.
    //
    // Sign only the body, and an attacker who captures one delivery can send it
    // again forever: the body never changes, so the signature stays valid. With the
    // timestamp inside the MAC, a receiver can reject anything older than a few
    // minutes — and moving the timestamp forward requires forging the signature,
    // which is the thing they cannot do.
    const body = '{"event":"record.deleted"}';
    const captured = sign("s", "1700000000", body);

    expect(verify("s", "1700000000", body, captured)).toBe(true);
    expect(verify("s", "1799999999", body, captured)).toBe(false); // replayed later
  });

  it("does not throw on a garbage signature", () => {
    // A malformed signature is an attacker's first move, and timingSafeEqual throws
    // on a length mismatch. Throwing here would turn "reject the delivery" into
    // "500 the dispatcher and stall the whole queue".
    expect(verify("s", "1700000000", "{}", "")).toBe(false);
    expect(verify("s", "1700000000", "{}", "sha256=zz")).toBe(false);
  });
});

describe("private addresses", () => {
  it("blocks the cloud metadata endpoint", () => {
    // 169.254.169.254 hands out IAM credentials to anything that asks. A webhook is
    // a URL the user chooses and OUR SERVER fetches — this is the whole attack.
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });

  it("blocks loopback and the private ranges", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("192.168.0.10")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
  });

  it("does NOT block the edges of 172/8 that are public", () => {
    // 172.15 and 172.32 are ordinary internet addresses. Blocking all of 172/8 is
    // the lazy version of this check and it breaks real receivers.
    expect(isPrivateAddress("172.15.0.1")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
  });

  it("blocks IPv6 loopback and unique-local", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
  });

  it("blocks an IPv4 loopback wearing an IPv6 hat", () => {
    // ::ffff:127.0.0.1 IS 127.0.0.1. Miss this and every check above is decorative.
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows an ordinary public address", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });
});

describe("backoff", () => {
  it("grows", () => {
    const delays = Array.from({ length: MAX_ATTEMPTS }, (_, i) => backoffMs(i + 1));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("starts at a minute, not a second", () => {
    // A receiver that is down is usually down for more than ten seconds. Retrying
    // fast helps nobody and turns an outage into a DDoS you're mounting on a
    // customer.
    expect(backoffMs(1)).toBe(60_000);
  });

  it("is bounded", () => {
    // Past the last step it stops growing rather than reading off the end of the
    // array and returning NaN — which would make next_attempt_at an invalid date
    // and the delivery would never be picked up again.
    expect(backoffMs(99)).toBe(backoffMs(MAX_ATTEMPTS));
    expect(Number.isFinite(backoffMs(99))).toBe(true);
  });
});
