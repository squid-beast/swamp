// Local-day date handling, shared by every date-laying view (calendar,
// timeline, gantt).
//
// ── Why this file exists ──
//
// `new Date("2026-07-14")` is midnight UTC, which is the 13th anywhere west of
// Greenwich. A view that gets this wrong shows every event one day early for
// half its users and looks fine to whoever built it. The calendar found and
// fixed this once; the timeline must not get to rediscover it. Every parse goes
// through localDate(), which reads a bare YYYY-MM-DD as a LOCAL day.

/** Parse a bare date string as a LOCAL day, not a UTC instant. */
export function localDate(value: unknown): Date | null {
  if (value == null || value === "") return null;

  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD in LOCAL time. `toISOString()` would shift the day across midnight. */
export function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Whole days from a to b, by local midnights — DST-safe via date arithmetic. */
export function daysBetween(a: Date, b: Date): number {
  const am = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bm = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((bm - am) / 86_400_000);
}

/** a + n days, in local time. */
export function addDays(a: Date, n: number): Date {
  return new Date(a.getFullYear(), a.getMonth(), a.getDate() + n);
}
