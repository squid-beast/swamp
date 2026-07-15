// ════════════════════════════════════════════════════════════════════════════
// Clipboard: TSV, not CSV, not JSON.
//
// TSV is what Excel and Google Sheets put on the clipboard and what they expect
// to receive. Get this right and a user can copy a block out of a spreadsheet and
// paste it straight into SWAMP, and back again, without thinking about it. Get it
// wrong — use CSV, or a bespoke JSON format — and the grid becomes an island.
//
// The awkward part is that a cell can legally contain a tab or a newline, and TSV
// uses both as delimiters. The convention (which Excel follows) is to wrap such a
// cell in double quotes and double any quotes inside it. Almost every naive
// implementation skips this and then silently corrupts any cell containing a
// line break — a long-text field, for instance, which is exactly the field people
// paste into.
// ════════════════════════════════════════════════════════════════════════════

/** Serialize a 2-D block of cells to TSV. */
export function toTSV(rows: unknown[][]): string {
  return rows.map((row) => row.map(cell).join("\t")).join("\n");
}

function cell(value: unknown): string {
  if (value == null) return "";

  // A multiSelect is an array. Excel has no concept of one, so it goes out as a
  // comma-joined string — which is also what it parses back from.
  const s = Array.isArray(value) ? value.join(", ") : String(value);

  if (!/[\t\n\r"]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Parse TSV back into a 2-D block.
 *
 * A hand-rolled scanner rather than `split("\n").map(l => l.split("\t"))`, because
 * that one-liner destroys any cell containing a newline — and the whole point of
 * the quoting rules is that such cells exist.
 */
export function fromTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // an escaped quote
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }

    if (c === "\t") {
      endField();
      i++;
      continue;
    }

    if (c === "\r") {
      // \r\n from Windows/Excel. Consume both, emit one row break.
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }

    if (c === "\n") {
      endRow();
      i++;
      continue;
    }

    field += c;
    i++;
  }

  // A trailing newline means the last row is empty and should be dropped; a
  // trailing value means it isn't.
  if (field !== "" || row.length) endRow();

  return rows;
}

// ─── Fill ───────────────────────────────────────────────────────────────────

/**
 * Extend a selection by dragging its corner.
 *
 * Two behaviours, and picking between them is the whole feature:
 *
 *   • A SERIES continues. Drag 1, 2 down and you get 3, 4, 5 — not 1, 2, 1, 2.
 *     Same for dates: Mon, Tue → Wed, Thu.
 *   • Anything else REPEATS. Drag "open" down and every cell becomes "open".
 *
 * A fill that only ever repeats is a fill people stop using, because the thing
 * they actually wanted (a numbered column, a run of dates) is the one thing it
 * won't do.
 *
 * `source` is the values in the dragged selection, in order. `count` is how many
 * values to produce.
 */
export function fillSeries(source: unknown[], count: number): unknown[] {
  if (!source.length) return [];

  const numeric = detectNumericSeries(source);
  if (numeric) {
    const { start, step } = numeric;
    return Array.from({ length: count }, (_, i) => String(start + step * (source.length + i)));
  }

  const dates = detectDateSeries(source);
  if (dates) {
    const { start, stepMs } = dates;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start.getTime() + stepMs * (source.length + i));
      return d.toISOString().slice(0, 10);
    });
  }

  // Repeat the source block, cycling.
  return Array.from({ length: count }, (_, i) => source[i % source.length]);
}

/**
 * A numeric run with a CONSTANT step.
 *
 * A single value is not a series — dragging one "5" down should give you 5, 5, 5,
 * not 6, 7, 8. That requires at least two values to establish an intent, and it's
 * the difference between a fill that feels helpful and one that feels possessed.
 */
function detectNumericSeries(source: unknown[]): { start: number; step: number } | null {
  if (source.length < 2) return null;

  const nums = source.map((v) => {
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) ? n : null;
  });
  if (nums.some((n) => n === null)) return null;

  const values = nums as number[];
  const step = values[1] - values[0];

  for (let i = 2; i < values.length; i++) {
    if (values[i] - values[i - 1] !== step) return null;
  }
  if (step === 0) return null; // constant: repeat, don't "increment by zero"

  return { start: values[0], step };
}

/** A run of dates with a constant step (daily, weekly, whatever). */
function detectDateSeries(source: unknown[]): { start: Date; stepMs: number } | null {
  if (source.length < 2) return null;

  const dates = source.map((v) => {
    const s = String(v ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  });
  if (dates.some((d) => d === null)) return null;

  const values = dates as Date[];
  const stepMs = values[1].getTime() - values[0].getTime();

  for (let i = 2; i < values.length; i++) {
    if (values[i].getTime() - values[i - 1].getTime() !== stepMs) return null;
  }
  if (stepMs === 0) return null;

  return { start: values[0], stepMs };
}

// ─── Coercion on paste ──────────────────────────────────────────────────────

/**
 * Turn a pasted string into a value the field can hold.
 *
 * Everything on the clipboard is a string. A multiSelect stores an array, and a
 * checkbox stores a boolean — so pasting "a, b" into a multiSelect must produce
 * `["a","b"]` and not the literal string, or every containment filter in the
 * product stops matching it.
 *
 * Values that are wrong for their type are passed through UNCHANGED, and the
 * server rejects them with a per-cell error. Silently dropping them would be
 * worse: the paste would appear to work and quietly lose data.
 */
export function coercePasted(type: string, raw: string): unknown {
  const s = raw.trim();
  if (s === "") return null;

  if (type === "multiSelect") {
    return s.split(",").map((v) => v.trim()).filter(Boolean);
  }

  if (type === "boolean") {
    const lower = s.toLowerCase();
    if (["true", "yes", "y", "1", "checked"].includes(lower)) return true;
    if (["false", "no", "n", "0", "unchecked"].includes(lower)) return false;
    return s; // let the server say it's invalid
  }

  return s;
}
