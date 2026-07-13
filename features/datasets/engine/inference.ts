import { FieldMeta, FieldType, SelectOption } from "@/core/types";

// ── Heuristic inference. Pure functions, no LLM. Catalog-driven: strong value
//    patterns first (they beat loose header keywords), then the "always-text"
//    rule (IDs/ZIP/SSN/phone never become number — leading zeros survive), then
//    header/format-assisted numeric types that require corroborating evidence. ──

const RE = {
  email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  url: /^https?:\/\/\S+$/i,
  image: /\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i,
  phone: /^\+?[\d\s().-]{7,20}$/,
  phoneDigits: /^(?:\D*\d){7,}\D*$/, // >=7 digits total, any formatting
  currency: /^-?[($€£₹¥]?\s?-?[\d,]+(\.\d{1,2})?\s?[)$€£₹¥]?$/,
  currencySymbol: /[$€£₹¥]/,
  money: /[$€£₹¥]|\.\d{2}(\D|$)|\d,\d{3}/, // symbol, 2-decimal, or thousands grouping
  percent: /^-?[\d.,]+\s?%$/,
  number: /^-?[\d,]+(\.\d+)?$/,
  isoDate: /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2})?)?/,
  isoDateTime: /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/,
  usDate: /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/,
  bool: /^(true|false|yes|no|y|n|0|1)$/i,
  time: /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?(\s?[AaPp][Mm])?$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  hexColor: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
  coordinates: /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/,
  year: /^(?:19|20)\d{2}$/,
  rating: /^[0-5](?:\.\d)?$/,
  leadingZero: /^0\d+$/,
};

// Header keyword → force-TEXT identifiers (never number; leading zeros preserved).
// Compound-prone words (invoice, tracking) are gated behind an id/no suffix so
// "invoice_amount" / "tracking_url" still reach their real value detectors.
const NAME_TEXT_ID =
  /(^|[^a-z])(zip|postal|ssn|ein|vat|tax[\s_-]?id|employee[\s_-]?id|emp[\s_-]?id|customer[\s_-]?id|cust[\s_-]?id|vendor[\s_-]?id|supplier[\s_-]?id|account[\s_-]?(id|no|number|num)|user[\s_-]?id|order[\s_-]?(id|no|number|num|#)|invoice[\s_-]?(id|no|number|num|#)|purchase[\s_-]?order|po[\s_-]?(no|number)|tracking[\s_-]?(id|no|number|num|#)|sku|barcode|upc|isbn|vin|passport|licen[cs]e|credit[\s_-]?card|card[\s_-]?(no|number)|routing|imei|serial[\s_-]?(no|number))([^a-z]|$)/i;
const NAME_PHONE = /(phone|mobile|cell|telephone|fax|whatsapp|contact[\s_-]?(no|number))/i;
// Money-ish headers. Word-boundaried so "coffee" doesn't match "fee". Promotion to
// currency still requires money-shaped values or an Excel currency format.
const NAME_CURRENCY =
  /(?:^|[\s_-])(price|cost|amount|salary|income|revenue|total|balance|budget|fee|payment|mrr|arr|wage|charge|subtotal|paid|due|profit|expense)(?:[\s_-]|$)/i;
// Percent-ish headers. "rate"/"ratio" deliberately excluded (too often money/counts).
const NAME_PERCENT = /(percent|percentage|discount|margin|completion|utilization)/i;
const NAME_DATE = /(date|dob|birth|deadline|expiry|expiration|_at$)/i;
const NAME_DATETIME = /(created|modified|updated|timestamp|logged|last[\s_-]?seen)/i;
const NAME_RATING = /(rating|stars?|(?:^|[\s_-])scores?(?:[\s_-]|$)|\breview\b)/i;
const NAME_YEAR = /(^year$|[\s_-]year$|fiscal[\s_-]?year|\bfy\b)/i;
const NAME_COLOR = /(colou?r|\bhex\b|swatch)/i;
const NAME_DURATION = /(duration|elapsed|runtime|time[\s_-]?spent)/i;
const NAME_IMAGE = /(image|photo|avatar|thumb|picture|img|logo)/i;

const STATUS_HINTS = [
  "pending", "approved", "rejected", "active", "inactive", "done", "todo",
  "in progress", "open", "closed", "shipped", "paid", "overdue", "draft",
  "published", "new", "won", "lost", "blocked", "review", "complete", "cancelled",
];

const PALETTE = ["amber", "violet", "teal", "rose", "sky", "lime", "orange", "fuchsia"];

// Excel cell-format signal for a column (from engine/import.ts).
export type FormatHint = { currency?: boolean; percent?: boolean; textFormatted?: boolean };

function nonEmpty(values: unknown[]): string[] {
  return values
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
    .map((v) => String(v).trim());
}

function ratio(values: string[], re: RegExp): number {
  if (!values.length) return 0;
  return values.filter((v) => re.test(v)).length / values.length;
}

function detectType(
  name: string,
  values: string[],
  totalRows: number,
  hint?: FormatHint
): { type: FieldType; confidence: number; options?: SelectOption[]; currency?: string } {
  const n = name.toLowerCase();
  if (!values.length) return { type: "text", confidence: 0.3 };

  const numeric = ratio(values, RE.number) > 0.9;
  const currencyOf = (v: string) => {
    const sym = v.match(RE.currencySymbol)?.[0];
    return sym === "€" ? "EUR" : sym === "£" ? "GBP" : sym === "₹" ? "INR" : sym === "¥" ? "JPY" : "USD";
  };

  // structural JSON
  if (values.every((v) => v.startsWith("{") || v.startsWith("["))) {
    try {
      values.slice(0, 5).forEach((v) => JSON.parse(v));
      return { type: "json", confidence: 0.95 };
    } catch {
      /* fall through */
    }
  }

  // ── Strong value shapes (distinctive characters: @ / http / - / : / $ / %).
  //    Run FIRST so a real value shape beats a loose header keyword (e.g.
  //    "invoice_amount" with $ → currency, "invoice_date" ISO → date). None of
  //    these collide with the pure-digit ZIP/SSN/id case protected below. ──
  if (ratio(values, RE.email) > 0.85) return { type: "email", confidence: 0.98 };
  if (ratio(values, RE.url) > 0.85) {
    if (ratio(values, RE.image) > 0.6 || NAME_IMAGE.test(n)) return { type: "image", confidence: 0.9 };
    return { type: "url", confidence: 0.95 };
  }
  if (ratio(values, RE.uuid) > 0.85) return { type: "uuid", confidence: 0.95 };
  if (ratio(values, RE.hexColor) > 0.8 || (NAME_COLOR.test(n) && ratio(values, RE.hexColor) > 0.5))
    return { type: "color", confidence: 0.9 };
  if (ratio(values, RE.coordinates) > 0.8) return { type: "coordinates", confidence: 0.9 };
  if (values.some((v) => RE.currencySymbol.test(v)) && ratio(values, RE.currency) > 0.85) {
    const sym = values.find((v) => RE.currencySymbol.test(v))!;
    return { type: "currency", confidence: 0.92, currency: currencyOf(sym) };
  }
  if (ratio(values, RE.percent) > 0.85) return { type: "percent", confidence: 0.92 };
  if (ratio(values, RE.isoDateTime) > 0.7) return { type: "datetime", confidence: 0.9 };
  if (ratio(values, RE.isoDate) > 0.85 || ratio(values, RE.usDate) > 0.85) return { type: "date", confidence: 0.92 };
  if (NAME_DURATION.test(n) && ratio(values, RE.time) > 0.6) return { type: "duration", confidence: 0.75 };
  if (ratio(values, RE.time) > 0.85 && !numeric) return { type: "time", confidence: 0.88 };

  // ── Always-TEXT identifiers (after strong shapes; only catches plain digit /
  //    alnum ids that no strong shape matched). Leading zeros / exact form kept. ──
  if (NAME_TEXT_ID.test(n)) {
    if (NAME_PHONE.test(n) && values.every((v) => RE.phoneDigits.test(v)))
      return { type: "phone", confidence: 0.85 };
    return { type: "text", confidence: 0.9 };
  }
  if (numeric && ratio(values, RE.leadingZero) > 0.3) return { type: "text", confidence: 0.82 };
  if (numeric && hint?.textFormatted) return { type: "text", confidence: 0.8 };

  // boolean
  if (ratio(values, RE.bool) > 0.95 && new Set(values.map((v) => v.toLowerCase())).size <= 2)
    return { type: "boolean", confidence: 0.9 };

  // ── Header/format-assisted numeric types — require corroborating evidence. ──
  // percent: Excel percent format, or a strong percent keyword.
  if ((hint?.percent && numeric) || (NAME_PERCENT.test(n) && numeric && !NAME_CURRENCY.test(n)))
    return { type: "percent", confidence: 0.85 };
  // currency: Excel currency format, or a money keyword WITH money-shaped values.
  if (numeric && (hint?.currency || (NAME_CURRENCY.test(n) && values.some((v) => RE.money.test(v))))) {
    const withSym = values.find((v) => RE.currencySymbol.test(v));
    return { type: "currency", confidence: 0.85, currency: withSym ? currencyOf(withSym) : "USD" };
  }
  // datetime / date by header + partial ISO shape (never on a numeric column).
  if (!numeric && NAME_DATETIME.test(n) && ratio(values, RE.isoDate) > 0.5)
    return { type: "datetime", confidence: 0.85 };
  if (!numeric && NAME_DATE.test(n) && ratio(values, RE.isoDate) > 0.5)
    return { type: "date", confidence: 0.85 };
  // rating (0–5) / year / numeric duration, all header-gated.
  if (NAME_RATING.test(n) && ratio(values, RE.rating) > 0.8) return { type: "rating", confidence: 0.85 };
  if (NAME_YEAR.test(n) && ratio(values, RE.year) > 0.85) return { type: "year", confidence: 0.85 };
  if (NAME_DURATION.test(n) && numeric) return { type: "duration", confidence: 0.7 };

  // phone
  if (ratio(values, RE.phone) > 0.85 && values.every((v) => RE.phoneDigits.test(v)) && NAME_PHONE.test(n))
    return { type: "phone", confidence: 0.9 };
  if (ratio(values, RE.phone) > 0.9 && values.every((v) => RE.phoneDigits.test(v)) && !numeric)
    return { type: "phone", confidence: 0.75 };

  // number (after the above, so ids / years / ratings aren't numberified)
  if (numeric) return { type: "number", confidence: 0.9 };

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

const GROUPABLE: FieldType[] = ["status", "singleSelect", "boolean", "year"];
const SEARCHABLE: FieldType[] = ["text", "longText", "email", "url", "uuid", "phone"];

let fidCounter = 0;
export function inferFields(
  columns: string[],
  rows: Record<string, unknown>[],
  formatHints: Record<string, FormatHint> = {}
): FieldMeta[] {
  const sample = rows.slice(0, 500);
  return columns.map((col) => {
    const raw = sample.map((r) => r[col]);
    const values = nonEmpty(raw);
    const det = detectType(col, values, sample.length, formatHints[col]);
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
      groupable: GROUPABLE.includes(det.type),
      searchable: SEARCHABLE.includes(det.type),
      // Raw JSON blobs add noise to a table; hide them by default. The field
      // stays in the registry, so anyone who wants it can unhide it.
      hidden: det.type === "json",
      confidence: det.confidence,
    };
  });
}
