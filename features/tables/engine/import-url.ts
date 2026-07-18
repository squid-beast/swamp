import "server-only";
import { safeFetch, SafeFetchError } from "@/features/tables/safe-fetch";
import { ImportError } from "@/features/tables/import-service";
import { parseSpreadsheetId } from "@/features/sheets/google/sheets";

// Fetch a user-supplied URL for import. The SSRF-safe fetch (validate every resolved
// address, pin the connection to it, follow redirects by hand) lives in safe-fetch;
// this adds the import-specific bits: rewrite Google Sheets links to a CSV endpoint,
// refuse an HTML page (an unshared sheet or a plain webpage), sniff xlsx, and hand
// the parser a filename it can branch on.

export interface FetchedFile {
  filename: string;
  buf: ArrayBuffer;
  text: string;
}

// A Google Sheets link becomes a public CSV endpoint. Publish-to-web (/d/e/<token>)
// and /d/<id> are different shapes; a private sheet still uses the authenticated
// Sheets connector, not this.
function normalize(input: string): string {
  if (!/\/spreadsheets\/d\//.test(input)) return input;

  const gid = input.match(/[#&?]gid=([0-9]+)/)?.[1];

  const pub = input.match(/\/spreadsheets\/d\/e\/([^/?#]+)/);
  if (pub) {
    return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ""}`;
  }

  const id = parseSpreadsheetId(input);
  if (!id) return input;
  const params = new URLSearchParams({ format: "csv" });
  if (gid) params.set("gid", gid);
  const key = input.match(/[#&?]resourcekey=([^&#]+)/)?.[1];
  if (key) params.set("resourcekey", key);
  return `https://docs.google.com/spreadsheets/d/${id}/export?${params}`;
}

export async function fetchImportUrl(rawUrl: string): Promise<FetchedFile> {
  const normalized = normalize(rawUrl.trim());

  let res;
  try {
    res = await safeFetch(normalized, { maxRedirects: 5, timeoutMs: 20_000 });
  } catch (e) {
    // Every deliberate safe-fetch failure is safe to show; the message is already
    // user-facing (private address, timed out, too large, …).
    if (e instanceof SafeFetchError) throw new ImportError(e.message);
    throw new ImportError("Couldn't fetch that URL.");
  }

  if (!res.ok) throw new ImportError(`The URL returned ${res.status}.`);

  const buf = res.buf;
  const bytes = new Uint8Array(buf);
  // XLSX is a ZIP (PK\x03\x04). Trust the magic bytes over path/content-type — a
  // signed S3 link or Drive export serves a spreadsheet from an extension-less path.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  const ct = res.contentType.toLowerCase();
  const charset = /charset=([^;]+)/.exec(ct)?.[1]?.trim();
  let text: string;
  try {
    text = new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    text = new TextDecoder("utf-8").decode(buf);
  }

  // An unshared Google Sheet (and any ordinary web page) answers 200 with an HTML
  // login/error page. Parsed as CSV that becomes a junk table, so refuse it.
  const looksHtml = /^\s*<(?:!doctype html|html|head|body)/i.test(text.slice(0, 256));
  if (!isZip && (ct.includes("text/html") || looksHtml)) {
    throw new ImportError(
      "That link returned a web page, not a data file. If it's a Google Sheet, share it as “Anyone with the link”, or use the Sheets connector for a private sheet."
    );
  }

  let base = "";
  try {
    base = new URL(res.url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    base = "";
  }

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
}
