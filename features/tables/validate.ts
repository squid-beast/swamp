import type { ValidatableField } from "./validate-types";

// ── Per-type validation, driven by the field catalog. Pure + shared by the grid
//    (invalid-cell flags) and the row form (input validation). Emptiness is a
//    required-ness concern handled by the form, so blank always validates. ──

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const OK: ValidationResult = { valid: true };
const bad = (error: string): ValidationResult => ({ valid: false, error });

const RE = {
  email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  url: /^https?:\/\/\S+$/i,
  phoneDigits: /^(?:\D*\d){7,}\D*$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  hexColor: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
  coordinates: /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/,
  time: /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?(\s?[AaPp][Mm])?$/,
  bool: /^(true|false|yes|no|y|n|0|1)$/i,
};

const num = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^0-9.eE+-]/g, ""));
  return isNaN(n) ? null : n;
};

export function validateValue(field: ValidatableField, value: unknown): ValidationResult {
  const s = value == null ? "" : String(value).trim();
  if (s === "") return OK;

  switch (field.type) {
    case "email":
      return RE.email.test(s) ? OK : bad("Enter a valid email address");
    case "url":
    case "image":
      return RE.url.test(s) || s.startsWith("/") ? OK : bad("Enter a valid URL");
    case "phone":
      return RE.phoneDigits.test(s) ? OK : bad("Enter a valid phone number");
    case "uuid":
      return RE.uuid.test(s) ? OK : bad("Not a valid UUID");
    case "color":
      return RE.hexColor.test(s) ? OK : bad("Use a hex color like #00AEEF");
    case "coordinates":
      return RE.coordinates.test(s) ? OK : bad("Use “latitude, longitude”");
    case "number":
    case "currency":
      return num(s) !== null ? OK : bad("Enter a number");
    case "percent":
      // Percentages can exceed 100 (growth) or go negative (decline) — just numeric.
      return num(s) !== null ? OK : bad("Enter a number");
    case "rating": {
      const n = num(s);
      return n !== null && n >= 0 && n <= 5 ? OK : bad("Must be between 0 and 5");
    }
    case "year": {
      const n = num(s);
      return n !== null && Number.isInteger(n) && n >= 1000 && n <= 9999
        ? OK
        : bad("Enter a 4-digit year");
    }
    case "date":
    case "datetime":
      return !isNaN(new Date(s).getTime()) ? OK : bad("Enter a valid date");
    case "time":
      return RE.time.test(s) ? OK : bad("Enter a valid time (HH:MM)");
    case "boolean":
      return RE.bool.test(s) ? OK : bad("Use yes or no");
    case "json":
      try {
        JSON.parse(s);
        return OK;
      } catch {
        return bad("Invalid JSON");
      }
    case "status":
    case "singleSelect":
      return !field.options?.length || field.options.some((o) => o.value === s)
        ? OK
        : bad("Not an allowed option");
    case "multiSelect": {
      if (!field.options?.length) return OK;
      const allowed = new Set(field.options.map((o) => o.value));
      const bogus = s.split(",").map((t) => t.trim()).filter((t) => t && !allowed.has(t));
      return bogus.length ? bad(`Not allowed: ${bogus.join(", ")}`) : OK;
    }
    case "user": {
      // Shape only — is this a uuid? Whether the uuid is a MEMBER is a question
      // this function cannot answer: it is sync, pure, shared with the grid, and
      // has no database. That check would need a roster lookup per keystroke.
      //
      // Shape is still worth enforcing, because `user` is writable through the
      // public API (PATCH /api/v1/.../records with a records:write token), and
      // without this "banana" lands in a column that means a person. A non-member
      // uuid renders as "Someone", which is wrong but legible; a word renders as
      // "Someone" too, and silently.
      const ids = Array.isArray(value) ? value : [value];
      return ids.every((v) => typeof v === "string" && RE.uuid.test(v.trim()))
        ? OK
        : bad("Pick a member");
    }
    default:
      return OK; // text, longText, duration — free-form
  }
}
