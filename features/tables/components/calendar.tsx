"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { Field, Record_ } from "../types";

// ════════════════════════════════════════════════════════════════════════════
// Calendar.
//
// A record lands on the calendar via a DATE RANGE: a from-field, and optionally a
// to-field. One date puts it on a day; two make it a span.
//
// ── Dates are local, and this is where that bites ──
//
// `new Date("2026-07-14")` is midnight UTC, which is the 13th anywhere west of
// Greenwich. A calendar that gets this wrong shows every event one day early for
// half its users and looks fine to whoever built it. Every parse here goes through
// localDate(), which reads a bare YYYY-MM-DD as a LOCAL day.
// ════════════════════════════════════════════════════════════════════════════

/** Parse a bare date string as a LOCAL day, not a UTC instant. */
function localDate(value: unknown): Date | null {
  if (value == null || value === "") return null;

  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** YYYY-MM-DD in LOCAL time. `toISOString()` would shift the day across midnight. */
function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Calendar({
  fields,
  records,
  fromField,
  onExpand,
  onSetDate,
}: {
  fields: Field[];
  records: Record_[];
  fromField: Field;
  onExpand: (recordId: string) => void;
  /** Dragging a record to another day rewrites its date. */
  onSetDate: (recordId: string, date: string) => void;
}) {
  const [month, setMonth] = React.useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [dragging, setDragging] = React.useState<string | null>(null);

  const primary = fields.find((f) => f.isPrimary);

  // The grid always starts on a Sunday and runs whole weeks, so the month sits in
  // a stable 6×7 shape rather than reflowing as you page through the year.
  const gridStart = React.useMemo(() => {
    const d = new Date(month);
    d.setDate(1 - d.getDay());
    return d;
  }, [month]);

  const days = React.useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        return d;
      }),
    [gridStart]
  );

  // Bucket records by day, once, rather than scanning every record for every cell.
  const byDay = React.useMemo(() => {
    const map = new Map<string, Record_[]>();

    for (const r of records) {
      const date = localDate(r.data[fromField.key]);
      if (!date) continue; // undated: not on the calendar, and that's correct

      const key = toDateString(date);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }

    return map;
  }, [records, fromField]);

  const undated = records.filter((r) => !localDate(r.data[fromField.key]));
  const today = new Date();

  const shiftMonth = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => shiftMonth(1)}>
            <ChevronRight className="size-4" />
          </Button>

          <span className="font-medium">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>

          <Button
            variant="ghost"
            size="sm"
            className="ml-1 h-8 text-[13px]"
            onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
          >
            Today
          </Button>
        </div>

        <div className="grid grid-cols-7 border-b">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="border-r px-2 py-1 text-[11px] font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-auto">
          {days.map((day) => {
            const key = toDateString(day);
            const items = byDay.get(key) ?? [];
            const otherMonth = day.getMonth() !== month.getMonth();

            return (
              <div
                key={key}
                onDragOver={(e) => dragging && e.preventDefault()}
                onDrop={() => {
                  if (dragging) onSetDate(dragging, key);
                  setDragging(null);
                }}
                className={cn(
                  "flex min-h-[5rem] flex-col gap-0.5 border-b border-r p-1",
                  otherMonth && "bg-muted/20"
                )}
                data-testid="calendar-day"
                data-date={key}
              >
                <span
                  className={cn(
                    "self-start rounded px-1 text-[11px] tabular-nums",
                    otherMonth ? "text-muted-foreground/50" : "text-muted-foreground",
                    sameDay(day, today) && "bg-brand font-semibold text-brand-foreground"
                  )}
                >
                  {day.getDate()}
                </span>

                {items.map((r) => (
                  <button
                    key={r.id}
                    draggable
                    onDragStart={() => setDragging(r.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => onExpand(r.id)}
                    className={cn(
                      "truncate rounded bg-brand/15 px-1 py-0.5 text-left text-[11px] hover:bg-brand/25",
                      dragging === r.id && "opacity-40"
                    )}
                    data-testid="calendar-event"
                  >
                    {primary ? String(r.data[primary.key] ?? "") || "Untitled" : "Untitled"}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Undated records. Drag one onto a day to schedule it — otherwise a record
          with no date is invisible on a calendar, and the user has no way to find
          out that it exists, let alone give it a date. */}
      {undated.length > 0 && (
        <aside className="flex w-56 shrink-0 flex-col border-l">
          <p className="border-b px-3 py-2 text-[12px] font-medium text-muted-foreground">
            No date ({undated.length})
          </p>
          <div className="flex flex-col gap-1 overflow-auto p-2">
            {undated.map((r) => (
              <button
                key={r.id}
                draggable
                onDragStart={() => setDragging(r.id)}
                onDragEnd={() => setDragging(null)}
                onClick={() => onExpand(r.id)}
                className="truncate rounded border bg-background px-2 py-1 text-left text-[12px] hover:border-brand/50"
              >
                {primary ? String(r.data[primary.key] ?? "") || "Untitled" : "Untitled"}
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
