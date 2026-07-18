import "server-only";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import { isPrivateAddress } from "@/features/tables/webhook-crypto";
import { ImportError } from "@/features/tables/import-service";
import { parseSpreadsheetId } from "@/features/sheets/google/sheets";

// Fetch a user-supplied URL for import.
//
// This is an SSRF surface: the server fetches whatever link the user pastes, so a
// link to http://169.254.169.254/ (cloud metadata) or an internal host would
// otherwise turn our server into the attacker's proxy AND hand the response back as
// table data — a read primitive against everything the server can reach.
//
// The guard resolves the hostname, refuses if ANY address is private, and then PINS
// the connection to the validated IP. Pinning is the part that actually works: fetch
// re-resolves DNS at connect time (undici Happy-Eyeballs), so validating a hostname
// and then handing that hostname to fetch lets a single static DNS answer with two A
// records — one public decoy, one 169.254.169.254 — connect to the private one. We
// dial the exact IP we checked, with the original Host/SNI, so there is no second
// resolution to subvert. Redirects are followed by hand and every hop is re-checked.

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — a table, not a disk image.
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;

export interface FetchedFile {
  /** A name with an extension the parser branches on (data.csv / data.json / .xlsx). */
  filename: string;
  buf: ArrayBuffer;
  text: string;
}

// Localhost is reachable only in development (so a webhook/import can be tested
// against a local receiver). Anchored to the WHOLE host — an unanchored "127." also
// matches 127.0.0.1.attacker.com, whose real DNS could point anywhere.
function isDevLocal(url: URL): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

function raceDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImportError(`${label} timed out.`)), Math.max(0, ms));
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// Resolve EVERY address, refuse if any is private, and return one public address to
// pin the connection to. lookup is raced against the request deadline so a blackholed
// DNS server can't hang the request past its own timeout.
async function resolvePinned(
  hostname: string,
  budgetMs: number
): Promise<{ address: string; family: number }> {
  let all: { address: string; family: number }[];
  try {
    all = await raceDeadline(lookup(hostname, { all: true }), budgetMs, "DNS lookup");
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`Can't resolve ${hostname}.`);
  }
  if (!all.length) throw new ImportError(`Can't resolve ${hostname}.`);
  for (const a of all) {
    if (isPrivateAddress(a.address)) {
      throw new ImportError(`Refusing to fetch ${hostname} — it resolves to a private address.`);
    }
  }
  return all[0];
}

// An Agent whose DNS is fixed to the one address we validated, so net.connect can't
// re-resolve to a different (private) address. Host header and TLS SNI still come
// from the URL, so certificate validation is unaffected.
function pinnedAgent(address: string, family: number): Agent {
  const fixed = (
    _hostname: string,
    options: { all?: boolean } | undefined,
    cb: (err: Error | null, address: unknown, family?: number) => void
  ) => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  // undici's connect.lookup expects Node's LookupFunction shape; ours matches at
  // runtime (both the all and single forms) but the published type is narrower.
  return new Agent({ connect: { lookup: fixed as never } });
}

// A Google Sheets link becomes a public CSV endpoint. Publish-to-web (/d/e/<token>)
// and /d/<id> are different shapes; a private sheet still uses the authenticated
// Sheets connector, not this.
function normalize(input: string): string {
  if (!/\/spreadsheets\/d\//.test(input)) return input;

  const gid = input.match(/[#&?]gid=([0-9]+)/)?.[1];

  // Publish-to-web: parseSpreadsheetId would capture just "e" from /d/e/<token>.
  const pub = input.match(/\/spreadsheets\/d\/e\/([^/?#]+)/);
  if (pub) {
    return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ""}`;
  }

  const id = parseSpreadsheetId(input);
  if (!id) return input;
  const params = new URLSearchParams({ format: "csv" });
  if (gid) params.set("gid", gid);
  // A resourcekey is Google's link-access token for some restricted shares; drop it
  // and the export is denied.
  const key = input.match(/[#&?]resourcekey=([^&#]+)/)?.[1];
  if (key) params.set("resourcekey", key);
  return `https://docs.google.com/spreadsheets/d/${id}/export?${params}`;
}

async function readCapped(res: UndiciResponse): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    void res.body?.cancel(); // free the socket rather than leave the body undrained
    throw new ImportError("That file is too large (20 MB max).");
  }

  const reader = res.body?.getReader();
  if (!reader) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      void reader.cancel();
      throw new ImportError("That file is too large (20 MB max).");
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

export async function fetchImportUrl(rawUrl: string): Promise<FetchedFile> {
  let current: URL;
  try {
    current = new URL(normalize(rawUrl.trim()));
  } catch {
    throw new ImportError("Enter a valid http(s) URL.");
  }

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let agent: Agent | undefined;
  try {
    let res!: UndiciResponse;
    for (let hop = 0; ; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new ImportError(`Refusing to fetch a ${current.protocol} URL.`);
      }

      let dispatcher: Agent | undefined;
      if (!isDevLocal(current)) {
        const pin = await resolvePinned(current.hostname, TIMEOUT_MS - (Date.now() - start));
        dispatcher = pinnedAgent(pin.address, pin.family);
      }

      // Retire the previous hop's pinned agent before opening the next.
      if (agent) void agent.close();
      agent = dispatcher;

      res = await undiciFetch(current, {
        dispatcher,
        redirect: "manual", // followed by hand so each destination is re-validated
        signal: controller.signal,
        headers: { "user-agent": "swamp-import/1", accept: "text/csv,application/json,*/*" },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        if (hop >= MAX_REDIRECTS) throw new ImportError("Too many redirects.");
        void res.body?.cancel();
        current = new URL(loc, current);
        continue;
      }
      break;
    }

    if (!res.ok) throw new ImportError(`The URL returned ${res.status}.`);

    const buf = await readCapped(res);
    const bytes = new Uint8Array(buf);
    // XLSX is a ZIP (PK\x03\x04). Trust the magic bytes over path/content-type — a
    // signed S3 link or Drive export serves a spreadsheet from an extension-less path.
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const charset = /charset=([^;]+)/.exec(ct)?.[1]?.trim();
    let text: string;
    try {
      text = new TextDecoder(charset || "utf-8").decode(buf);
    } catch {
      text = new TextDecoder("utf-8").decode(buf);
    }

    // An unshared Google Sheet (and any ordinary web page) answers 200 with an HTML
    // login/error page. Parsed as CSV that becomes a junk table, so refuse it with a
    // hint instead of silently importing markup.
    const looksHtml = /^\s*<(?:!doctype html|html|head|body)/i.test(text.slice(0, 256));
    if (!isZip && (ct.includes("text/html") || looksHtml)) {
      throw new ImportError(
        "That link returned a web page, not a data file. If it's a Google Sheet, share it as “Anyone with the link”, or use the Sheets connector for a private sheet."
      );
    }

    const base = current.pathname.split("/").filter(Boolean).pop() ?? "";
    let filename: string;
    if (isZip) {
      filename = /\.xlsx?$/i.test(base) ? base : `${base || "import"}.xlsx`;
    } else if (/\.[a-z0-9]+$/i.test(base)) {
      filename = base;
    } else {
      const ext = ct.includes("json") ? "json" : "csv";
      filename = `${base || "import"}.${ext}`;
    }

    return { filename, buf, text };
  } finally {
    clearTimeout(timer);
    if (agent) void agent.close();
  }
}
