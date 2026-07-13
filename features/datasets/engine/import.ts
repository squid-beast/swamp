import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Dataset, Row } from "@/features/datasets/types";
import { inferFields, type FormatHint } from "./inference";
import { recommendViews } from "./recommend";

// ── Every source funnels into ingest(). Adding a source = adding one parser. ──

export interface ParsedTable {
  columns: string[];
  rows: Record<string, unknown>[];
  formatHints?: Record<string, FormatHint>; // per-column Excel number-format signals
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
  // cellNF → expose each cell's number format (.z); cellDates → real Date objects.
  const wb = XLSX.read(buf, { type: "array", cellDates: true, cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = ws?.["!ref"];
  if (!ref) return { columns: [], rows: [], formatHints: {} };
  const range = XLSX.utils.decode_range(ref);
  const r0 = range.s.r;

  // Header row → column name + sheet column index (dedupe blank/repeated headers).
  const cols: { name: string; c: number }[] = [];
  const used = new Set<string>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: r0, c })];
    let name = cell ? String(cell.v ?? "").trim() : "";
    if (!name) name = `col_${c + 1}`;
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    cols.push({ name, c });
  }

  // Tally each column's cell formats so a currency/percent/text column types
  // correctly even when a value has no $ or % character.
  const fmt: Record<string, { cur: number; pct: number; txt: number; seen: number }> = {};
  for (const { name } of cols) fmt[name] = { cur: 0, pct: 0, txt: 0, seen: 0 };

  const rows: Record<string, unknown>[] = [];
  for (let r = r0 + 1; r <= range.e.r; r++) {
    const row: Record<string, unknown> = {};
    let empty = true;
    for (const { name, c } of cols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let val: unknown = "";
      // Skip error cells (#DIV/0! etc.) — their .v is a numeric error code that
      // would pollute the column; treat them as empty.
      if (cell && cell.t !== "e" && cell.v !== undefined && cell.v !== null && cell.v !== "") {
        empty = false;
        const z = String(cell.z ?? "");
        const isPct = /%/.test(z);
        const isCur = !isPct && /[$€£₹¥]|\[\$/.test(z);
        const f = fmt[name];
        f.seen++;
        if (cell.t === "s") f.txt++;
        if (isPct) f.pct++;
        else if (isCur) f.cur++;
        if (cell.t === "d" && cell.v instanceof Date) {
          val = excelDateToString(cell.v);
        } else if (isCur && typeof cell.w === "string") {
          // Keep Excel's rendered currency (symbol → correct currency detection),
          // but restore a minus lost to accounting/parenthesis negatives.
          val =
            typeof cell.v === "number" && cell.v < 0 && !cell.w.includes("-")
              ? `-${cell.w.replace(/[()]/g, "")}`
              : cell.w;
        } else if (isPct && typeof cell.w === "string") {
          val = cell.w; // Excel renders "25%"; the raw value is the 0.25 fraction.
        } else {
          val = cell.v;
        }
      }
      row[name] = val;
    }
    if (!empty) rows.push(row);
  }

  const formatHints: Record<string, FormatHint> = {};
  for (const { name } of cols) {
    const f = fmt[name];
    if (!f.seen) continue;
    const h: FormatHint = {};
    if (f.cur / f.seen > 0.5) h.currency = true;
    if (f.pct / f.seen > 0.5) h.percent = true;
    if (f.txt / f.seen > 0.7) h.textFormatted = true;
    if (Object.keys(h).length) formatHints[name] = h;
  }

  return { columns: cols.map((x) => x.name), rows, formatHints };
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
  const fields = inferFields(table.columns, table.rows, table.formatHints);
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
