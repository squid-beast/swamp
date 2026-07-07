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
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows };
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
