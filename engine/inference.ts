import { FieldMeta, FieldType, SelectOption } from "@/core/types";

// ── Heuristic pass. Pure functions, no LLM. An optional LLM pass can refine
//    low-confidence fields later (engine/llm.ts stub) without changing callers. ──

const RE = {
  email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  url: /^https?:\/\/\S+$/i,
  image: /\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i,
  phone: /^\+?[\d\s().-]{7,20}$/,
  phoneDigits: /^(?:\D*\d){7,}\D*$/,  // >=7 digits total, any formatting
  currency: /^[($€£₹¥]?\s?-?[\d,]+(\.\d{1,2})?\s?[)$€£₹¥]?$/,
  currencySymbol: /[$€£₹¥]/,
  percent: /^-?[\d.,]+\s?%$/,
  number: /^-?[\d,]+(\.\d+)?$/,
  isoDate: /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2})?)?/,
  usDate: /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/,
  bool: /^(true|false|yes|no|y|n|0|1)$/i,
};

const STATUS_HINTS = [
  "pending", "approved", "rejected", "active", "inactive", "done", "todo",
  "in progress", "open", "closed", "shipped", "paid", "overdue", "draft",
  "published", "new", "won", "lost", "blocked", "review", "complete", "cancelled",
];

const PALETTE = ["amber", "violet", "teal", "rose", "sky", "lime", "orange", "fuchsia"];

function nonEmpty(values: unknown[]): string[] {
  return values
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
    .map((v) => String(v).trim());
}

function ratio(values: string[], re: RegExp): number {
  if (!values.length) return 0;
  return values.filter((v) => re.test(v)).length / values.length;
}

function detectType(name: string, values: string[], totalRows: number): { type: FieldType; confidence: number; options?: SelectOption[]; currency?: string } {
  const n = name.toLowerCase();
  if (!values.length) return { type: "text", confidence: 0.3 };

  // structural
  if (values.every((v) => v.startsWith("{") || v.startsWith("["))) {
    try { values.slice(0, 5).forEach((v) => JSON.parse(v)); return { type: "json", confidence: 0.95 }; } catch { /* fall through */ }
  }

  if (ratio(values, RE.email) > 0.85) return { type: "email", confidence: 0.98 };
  if (ratio(values, RE.url) > 0.85) {
    const img = ratio(values, RE.image);
    if (img > 0.6 || /image|photo|avatar|thumb|picture|img/.test(n)) return { type: "image", confidence: 0.9 };
    return { type: "url", confidence: 0.95 };
  }
  if (ratio(values, RE.bool) > 0.95 && new Set(values.map((v) => v.toLowerCase())).size <= 2)
    return { type: "boolean", confidence: 0.9 };
  if (ratio(values, RE.percent) > 0.85) return { type: "percent", confidence: 0.95 };
  if (ratio(values, RE.currency) > 0.85 && (values.some((v) => RE.currencySymbol.test(v)) || /price|cost|salary|revenue|amount|total|mrr|arr|budget/.test(n))) {
    const sym = values.find((v) => RE.currencySymbol.test(v))?.match(RE.currencySymbol)?.[0];
    const currency = sym === "€" ? "EUR" : sym === "£" ? "GBP" : sym === "₹" ? "INR" : sym === "¥" ? "JPY" : "USD";
    return { type: "currency", confidence: 0.92, currency };
  }
  if (ratio(values, RE.isoDate) > 0.85 || ratio(values, RE.usDate) > 0.85 || (/date|created|updated|_at$|time/.test(n) && ratio(values, RE.isoDate) > 0.5))
    return { type: "date", confidence: 0.93 };
  if (ratio(values, RE.phone) > 0.85 && values.every((v) => RE.phoneDigits.test(v)) && /phone|mobile|tel|contact/.test(n))
    return { type: "phone", confidence: 0.9 };
  if (ratio(values, RE.phone) > 0.9 && values.every((v) => RE.phoneDigits.test(v)) && ratio(values, RE.number) < 0.5)
    return { type: "phone", confidence: 0.75 };
  if (ratio(values, RE.number) > 0.9) return { type: "number", confidence: 0.9 };

  // multi-select: comma-separated repeated tokens
  const commaVals = values.filter((v) => v.includes(","));
  if (commaVals.length / values.length > 0.4) {
    const tokens = new Set(values.flatMap((v) => v.split(",").map((t) => t.trim())));
    if (tokens.size <= Math.max(12, values.length * 0.5) && tokens.size < values.length) {
      const options = [...tokens].slice(0, 24).map((value, i) => ({ value, color: PALETTE[i % PALETTE.length] }));
      return { type: "multiSelect", confidence: 0.8, options };
    }
  }

  // select / status: low cardinality
  const uniq = [...new Set(values)];
  const card = uniq.length;
  const avgValLen = values.reduce((a, v) => a + v.length, 0) / values.length;
  if (card >= 2 && card <= 12 && totalRows >= 6 && card / values.length <= 0.6 && avgValLen <= 40) {
    const options = uniq.map((value, i) => ({ value, color: PALETTE[i % PALETTE.length] }));
    const statusLike =
      /status|stage|state|phase|priority/.test(n) ||
      uniq.filter((u) => STATUS_HINTS.includes(u.toLowerCase())).length / card >= 0.5;
    return { type: statusLike ? "status" : "singleSelect", confidence: statusLike ? 0.9 : 0.82, options };
  }

  if (avgValLen > 80) return { type: "longText", confidence: 0.7 };
  return { type: "text", confidence: 0.6 };
}

function toDisplayName(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

let fidCounter = 0;
export function inferFields(columns: string[], rows: Record<string, unknown>[]): FieldMeta[] {
  const sample = rows.slice(0, 500);
  return columns.map((col) => {
    const raw = sample.map((r) => r[col]);
    const values = nonEmpty(raw);
    const det = detectType(col, values, sample.length);
    const uniq = new Set(values);
    return {
      id: `f_${col.replace(/\W+/g, "_").toLowerCase()}_${fidCounter++}`,
      sourceName: col,
      displayName: toDisplayName(col),
      type: det.type,
      nullable: values.length < raw.length,
      unique: uniq.size === values.length && values.length > 0,
      options: det.options,
      currency: det.currency,
      sortable: true,
      filterable: true,
      groupable: det.type === "status" || det.type === "singleSelect" || det.type === "boolean",
      searchable: ["text", "longText", "email", "url"].includes(det.type),
      // Raw JSON blobs add noise to a table; hide them by default. The field
      // stays in the registry, so anyone who wants it can unhide it.
      hidden: det.type === "json",
      confidence: det.confidence,
    };
  });
}
