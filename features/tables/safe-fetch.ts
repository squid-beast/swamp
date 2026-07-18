import "server-only";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import { isPrivateAddress } from "./webhook-crypto";

// ════════════════════════════════════════════════════════════════════════════
// One SSRF-safe fetch, shared by everything that fetches a URL a USER chose — the
// webhook dispatcher and the URL importer.
//
// The hard part isn't the private-address check; it's that fetch RE-RESOLVES DNS at
// connect time (undici Happy-Eyeballs, default-on in Node 20+). So validating a
// hostname and then handing that hostname to fetch lets a single static DNS answer
// with two A records — one public decoy, one 169.254.169.254 — connect to the
// private one. The only thing that actually closes it is to resolve every address,
// refuse if ANY is private, and PIN the connection to the exact IP we validated,
// with the original Host/SNI so TLS still checks out. Redirects are followed by hand
// and every hop is re-validated.
//
// The residual is the DNS-rebinding race between our resolve and undici's: we pin
// the IP, so that race is closed for the primary connection; a second resolution
// can't happen. This stops the accident, the casual attempt, and the two-record
// decoy — not a kernel-level TOCTOU on the pinned socket, which is out of reach here.
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** A deliberate refusal or failure. `refused` = the URL is unsafe/unreachable and
 *  retrying won't help (private address, bad protocol, redirect loop, DNS miss);
 *  otherwise it's transient (timeout, connection reset, oversize). */
export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly refused: boolean
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** 0 = don't follow redirects (return the 3xx as-is). */
  maxRedirects?: number;
  maxBytes?: number;
  /** On exceeding maxBytes: truncate (keep the partial body) instead of throwing. */
  truncate?: boolean;
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  contentType: string;
  /** The final URL after any redirects (for filename inference). */
  url: string;
  buf: ArrayBuffer;
}

// Localhost is reachable only in development. Anchored to the WHOLE host — an
// unanchored "127." also matches 127.0.0.1.attacker.com, whose real DNS could point
// anywhere.
function isDevLocal(url: URL): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

function raceDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SafeFetchError("DNS lookup timed out.", false)), Math.max(0, ms));
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function resolvePinned(hostname: string, budgetMs: number): Promise<{ address: string; family: number }> {
  let all: { address: string; family: number }[];
  try {
    all = await raceDeadline(lookup(hostname, { all: true }), budgetMs);
  } catch (e) {
    if (e instanceof SafeFetchError) throw e;
    throw new SafeFetchError(`Can't resolve ${hostname}.`, true);
  }
  if (!all.length) throw new SafeFetchError(`Can't resolve ${hostname}.`, true);
  for (const a of all) {
    if (isPrivateAddress(a.address)) {
      throw new SafeFetchError(`Refusing to fetch ${hostname} — it resolves to a private address.`, true);
    }
  }
  return all[0];
}

function pinnedAgent(address: string, family: number): Agent {
  const fixed = (
    _hostname: string,
    options: { all?: boolean } | undefined,
    cb: (err: Error | null, address: unknown, family?: number) => void
  ) => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  return new Agent({ connect: { lookup: fixed as never } });
}

async function readCapped(res: UndiciResponse, maxBytes: number, truncate: boolean): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes && !truncate) {
    void res.body?.cancel();
    throw new SafeFetchError("The response is too large.", false);
  }

  const reader = res.body?.getReader();
  if (!reader) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel();
      if (truncate) break; // keep what we have (webhook: only a snippet is logged)
      throw new SafeFetchError("The response is too large.", false);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(Math.min(total, chunks.reduce((n, c) => n + c.byteLength, 0)));
  let offset = 0;
  for (const c of chunks) {
    if (offset + c.byteLength > out.length) {
      out.set(c.subarray(0, out.length - offset), offset);
      break;
    }
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

export async function safeFetch(rawUrl: string | URL, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? 0;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let current: URL;
  try {
    current = new URL(String(rawUrl));
  } catch {
    throw new SafeFetchError("Not a valid URL.", true);
  }

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let agent: Agent | undefined;
  try {
    let res!: UndiciResponse;
    for (let hop = 0; ; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new SafeFetchError(`Refusing to fetch a ${current.protocol} URL.`, true);
      }

      let dispatcher: Agent | undefined;
      if (!isDevLocal(current)) {
        const pin = await resolvePinned(current.hostname, timeoutMs - (Date.now() - start));
        dispatcher = pinnedAgent(pin.address, pin.family);
      }

      if (agent) void agent.close();
      agent = dispatcher;

      try {
        res = await undiciFetch(current, {
          method: opts.method ?? "GET",
          headers: opts.headers,
          body: opts.body,
          dispatcher,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof SafeFetchError) throw e;
        const name = (e as Error).name;
        throw new SafeFetchError(name === "AbortError" ? "timed out" : (e as Error).message || "connection failed", false);
      }

      if (res.status >= 300 && res.status < 400 && maxRedirects > 0) {
        const loc = res.headers.get("location");
        if (!loc) break;
        if (hop >= maxRedirects) throw new SafeFetchError("Too many redirects.", true);
        void res.body?.cancel();
        current = new URL(loc, current);
        continue;
      }
      break;
    }

    const buf = await readCapped(res, maxBytes, opts.truncate ?? false);
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type") ?? "",
      url: current.href,
      buf,
    };
  } finally {
    clearTimeout(timer);
    if (agent) void agent.close();
  }
}
