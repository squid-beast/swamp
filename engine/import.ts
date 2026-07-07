import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Dataset, Row } from "@/core/types";
import { inferFields } from "./inference";
import { recommendViews } from "./recommend";

// ── Every source funnels into ingest(). Adding a source = adding one parser. ──

export interface ParsedTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function parseCSV(text: string): ParsedTable {
  const res = Papa.parse<Record<string, unknown>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const columns = res.meta.fields ?? [];
  return { columns, rows: res.data };
}

export function parseXLSX(buf: ArrayBuffer): ParsedTable {
  // cellDates → date-formatted cells become JS Date objects instead of raw
  // serials (e.g. 46142), so a "Date" column doesn't get typed as a number.
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  // Normalize Date objects to date-only / ISO-like strings so inference detects
  // "date" and JSON storage round-trips cleanly. Uses the date's own calendar
  // fields (SheetJS aligns them to the sheet's date) — no timezone off-by-one.
  const rows = raw.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? excelDateToString(v) : v;
    return out;
  });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// A spreadsheet Date → "YYYY-MM-DD" (or "YYYY-MM-DDThh:mm:ss" when it carries a
// real time). SheetJS can reconstruct a whole-day serial a hair off midnight
// (e.g. ...T23:59:59 in half-hour-offset zones like IST), so snap values within
// 2s of a day boundary to the day — otherwise a date-only cell can show a day early.
function excelDateToString(d: Date): string {
  const sinceMidnight = d.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 86_400_000;
  if (sinceMidnight <= 2000 || sinceMidnight >= dayMs - 2000) {
    return ymd(new Date(d.getTime() + (sinceMidnight >= dayMs - 2000 ? 2000 : 0)));
  }
  return `${ymd(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Accepts: array of objects, {data:[...]}, {rows:[...]}, {records:[...]}, single object, nested webhook payloads.
export function parseJSON(text: string): ParsedTable {
  const parsed = JSON.parse(text);
  const arr = extractArray(parsed);
  const rows = arr.map((r) => flatten(r));
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { columns, rows };
}

function extractArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const key of ["data", "rows", "records", "items", "results", "values"]) {
      if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
    }
    // deep scan: first array of objects found
    for (const val of Object.values(o)) {
      if (Array.isArray(val) && val.length && typeof val[0] === "object")
        return val as Record<string, unknown>[];
    }
    return [o];
  }
  return [];
}

// One-level flatten; deeper nesting is preserved as JSON strings (renders as json type).
export function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !prefix) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else if (v && typeof v === "object") {
      out[key] = JSON.stringify(v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

export function ingest(
  name: string,
  source: Dataset["source"],
  table: ParsedTable
): { dataset: Dataset; rows: Row[] } {
  const fields = inferFields(table.columns, table.rows);
  // remap rows from source column names to stable field ids
  const rows: Row[] = table.rows.map((r, i) => {
    const row: Row = { __id: `r_${i}` };
    for (const f of fields) row[f.id] = r[f.sourceName] ?? null;
    return row;
  });
  const now = new Date().toISOString();
  const dataset: Dataset = {
    id: `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    source,
    createdAt: now,
    updatedAt: now,
    fields,
    overrides: {},
    views: recommendViews(fields),
    rowCount: rows.length,
  };
  return { dataset, rows };
}
