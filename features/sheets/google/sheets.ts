// Minimal Google Sheets + OAuth token helpers (server-only). No SDK; plain fetch.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export const isGoogleConfigured = !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET;

/** The one scope the Sheets connector needs — read a spreadsheet the user picks. */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/** True when a stored credential's granted scope actually includes Sheets read. A
 *  bare Google sign-in grants none, so this is what separates a Sheets credential
 *  from a leftover sign-in token. */
export const hasSheetsScope = (scope: string | null | undefined) =>
  !!scope && scope.includes("spreadsheets");

/** What a Google access token is actually allowed to do, straight from Google.
 *  Returns "" if it can't be determined — the caller then treats it as un-scoped. */
export async function fetchGrantedScope(accessToken: string): Promise<string> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) return "";
    const json = (await res.json()) as { scope?: string };
    return json.scope ?? "";
  } catch {
    return "";
  }
}

// Exchange a stored refresh token for a fresh, short-lived access token.
export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("google token refresh: no access_token");
  return json.access_token;
}

/** Pull Google's real error reason out of a failed Sheets response so a 403 says
 *  WHICH 403 it is: the API being disabled, the account lacking access to this
 *  sheet, or an insufficient scope. Google returns { error: { message, status } }. */
async function googleErrorDetail(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string; status?: string } };
    const msg = json.error?.message?.trim();
    return msg ? ` — ${msg}` : "";
  } catch {
    return "";
  }
}

/** A spreadsheet's own file title plus its tab titles. The file title names the
 *  base on import; the tab title names the table. Fetched in one metadata call so
 *  a one-sheet import never shows the same name twice. */
export interface SpreadsheetInfo {
  title: string;
  tabs: string[];
}

export async function getSpreadsheetInfo(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetInfo> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`sheets metadata failed (${res.status})${await googleErrorDetail(res)}`);
  }
  const json = (await res.json()) as {
    properties?: { title?: string };
    sheets?: { properties: { title: string } }[];
  };
  return {
    title: json.properties?.title?.trim() || "Imported sheet",
    tabs: (json.sheets ?? []).map((s) => s.properties.title),
  };
}

export type SheetTable = { columns: string[]; rows: Record<string, string>[] };

// Read a tab as a table: row 1 is the header, the rest are objects keyed by header.
export async function readSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<SheetTable> {
  const range = encodeURIComponent(sheetTitle);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`sheets read failed (${res.status})${await googleErrorDetail(res)}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  const values = json.values ?? [];
  const header = values[0] ?? [];
  const columns = header.map((h, i) => (h?.trim() ? h.trim() : `col_${i + 1}`));
  const rows = values.slice(1).map((r) => {
    const o: Record<string, string> = {};
    columns.forEach((c, i) => {
      o[c] = r[i] ?? "";
    });
    return o;
  });
  return { columns, rows };
}

// Accept a full Sheets URL or a raw spreadsheet id.
export function parseSpreadsheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  const trimmed = input.trim();
  return /^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null;
}
