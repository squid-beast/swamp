"use client";

import * as React from "react";
import { cn } from "@/shared/lib/utils";
import type { Field, Record_ } from "../types";
import { addDays, daysBetween, localDate, toDateString } from "../local-date";

// ════════════════════════════════════════════════════════════════════════════
// Timeline and Gantt — ONE renderer, two view types.
//
// They differ only in the dependency arrows: gantt passes a self-referential
// link field whose targets are a bar's predecessors, and this draws SVG lines
// between the bars. Everything else — the day scale, the bars, the drag — is
// identical, so building two components would be building one twice.
//
// A record lands on the timeline via the same config.ranges the calendar uses:
// a from-field, and optionally a to-field. Dates parse through ../local-date;
// see that file for why `new Date("2026-07-14")` is a bug.
//
// Dragging a bar horizontally reschedules it (both ends move; the duration is
// preserved) through the same onSetDate path the calendar uses, so it is
// undoable like every other edit.
// ════════════════════════════════════════════════════════════════════════════

const DAY_PX = 28;
const ROW_PX = 36;
const LABEL_W = 220;

interface Bar {
  record: Record_;
  start: Date;
  end: Date; // inclusive
  row: number;
}

export function Timeline({
  fields,
  records,
  fromField,
  toField,
  dependencyField,
  onExpand,
  onSetDate,
}: {
  fields: Field[];
  records: Record_[];
  fromField: Field;
  toField?: Field;
  /** Present = gantt: draw arrows from each record's linked predecessors. */
  dependencyField?: Field;
  onExpand: (recordId: string) => void;
  /** Reschedule: writes the from-field (and to-field when present) as dates. */
  onSetDate: (recordId: string, patch: Record<string, string>) => void;
}) {
  const primary = fields.find((f) => f.isPrimary);
  const [dragging, setDragging] = React.useState<{
    id: string;
    startX: number;
    offsetDays: number;
  } | null>(null);

  // One row per dated record, in the order the query returned them (the view's
  // sort). Undated records simply don't appear — same rule as the calendar.
  const bars = React.useMemo(() => {
    const out: Bar[] = [];
    for (const r of records) {
      const start = localDate(r.data[fromField.key]);
      if (!start) continue;
      const end = (toField && localDate(r.data[toField.key])) || start;
      out.push({ record: r, start, end: end < start ? start : end, row: out.length });
    }
    return out;
  }, [records, fromField, toField]);

  // The visible window: from the earliest bar to the latest, padded a week each
  // side. An empty view shows the current month.
  const [rangeStart, totalDays] = React.useMemo(() => {
    if (!bars.length) {
      const now = new Date();
      return [new Date(now.getFullYear(), now.getMonth(), 1), 31] as const;
    }
    let min = bars[0].start;
    let max = bars[0].end;
    for (const b of bars) {
      if (b.start < min) min = b.start;
      if (b.end > max) max = b.end;
    }
    const start = addDays(min, -7);
    return [start, daysBetween(start, addDays(max, 7)) + 1] as const;
  }, [bars]);

  const x = (d: Date) => daysBetween(rangeStart, d) * DAY_PX;

  // Month labels along the top.
  const months = React.useMemo(() => {
    const out: { label: string; left: number }[] = [];
    let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const end = addDays(rangeStart, totalDays);
    while (d < end) {
      out.push({
        label: d.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
        left: Math.max(0, x(d)),
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, totalDays]);

  const byId = React.useMemo(() => new Map(bars.map((b) => [b.record.id, b])), [bars]);

  // Gantt arrows: from each predecessor's bar-end to this bar's start. The link
  // cell's value is [{id, label}] — resolved by the catalog, no extra query.
  const arrows = React.useMemo(() => {
    if (!dependencyField) return [];
    const out: { from: Bar; to: Bar }[] = [];
    for (const b of bars) {
      const linked = b.record.data[dependencyField.key];
      if (!Array.isArray(linked)) continue;
      for (const l of linked) {
        const dep = l && typeof l === "object" ? byId.get((l as { id: string }).id) : undefined;
        if (dep) out.push({ from: dep, to: b });
      }
    }
    return out;
  }, [bars, byId, dependencyField]);

  const today = new Date();
  const todayX = x(today);

  const commitDrag = (bar: Bar, offsetDays: number) => {
    if (!offsetDays) return;
    const patch: Record<string, string> = {
      [fromField.key]: toDateString(addDays(bar.start, offsetDays)),
    };
    if (toField) patch[toField.key] = toDateString(addDays(bar.end, offsetDays));
    onSetDate(bar.record.id, patch);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="timeline">
      <div
        className="relative"
        style={{ width: LABEL_W + totalDays * DAY_PX, minHeight: 24 + bars.length * ROW_PX }}
      >
        {/* Month header */}
        <div className="sticky top-0 z-10 flex h-6 border-b bg-background" style={{ marginLeft: LABEL_W }}>
          {months.map((m) => (
            <span
              key={m.label}
              className="absolute text-[11px] text-muted-foreground"
              style={{ left: LABEL_W + m.left + 4 }}
            >
              {m.label}
            </span>
          ))}
        </div>

        {/* Today line */}
        {todayX >= 0 && todayX <= totalDays * DAY_PX && (
          <div
            className="absolute bottom-0 top-6 w-px bg-brand/60"
            style={{ left: LABEL_W + todayX }}
          />
        )}

        {/* Dependency arrows under the bars */}
        {arrows.length > 0 && (
          <svg
            className="pointer-events-none absolute left-0 top-6 h-full w-full"
            style={{ height: bars.length * ROW_PX }}
          >
            {arrows.map((a, i) => {
              const x1 = LABEL_W + x(a.from.end) + DAY_PX; // end of predecessor
              const y1 = a.from.row * ROW_PX + ROW_PX / 2;
              const x2 = LABEL_W + x(a.to.start);
              const y2 = a.to.row * ROW_PX + ROW_PX / 2;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${x1 + 16} ${y1}, ${x2 - 16} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  className="stroke-muted-foreground/50"
                  strokeWidth={1.5}
                  markerEnd="url(#tl-arrow)"
                />
              );
            })}
            <defs>
              <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground/50" />
              </marker>
            </defs>
          </svg>
        )}

        {/* Rows */}
        {bars.map((b) => {
          const left = x(b.start);
          const width = (daysBetween(b.start, b.end) + 1) * DAY_PX;
          const label = primary ? String(b.record.data[primary.key] ?? "—") : "—";
          const shift = dragging?.id === b.record.id ? dragging.offsetDays * DAY_PX : 0;

          return (
            <div
              key={b.record.id}
              className="absolute flex w-full items-center border-b border-border/50"
              style={{ top: 24 + b.row * ROW_PX, height: ROW_PX }}
            >
              <button
                onClick={() => onExpand(b.record.id)}
                className="sticky left-0 z-10 h-full shrink-0 truncate border-r bg-background px-3 text-left text-[13px] hover:text-brand"
                style={{ width: LABEL_W }}
              >
                {label}
              </button>
              <div
                role="button"
                tabIndex={0}
                title={`${toDateString(b.start)} → ${toDateString(b.end)}`}
                onKeyDown={(e) => e.key === "Enter" && onExpand(b.record.id)}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging({ id: b.record.id, startX: e.clientX, offsetDays: 0 });
                }}
                onPointerMove={(e) => {
                  if (dragging?.id !== b.record.id) return;
                  setDragging({
                    ...dragging,
                    offsetDays: Math.round((e.clientX - dragging.startX) / DAY_PX),
                  });
                }}
                onPointerUp={() => {
                  if (dragging?.id !== b.record.id) return;
                  const offset = dragging.offsetDays;
                  setDragging(null);
                  if (offset === 0) onExpand(b.record.id);
                  else commitDrag(b, offset);
                }}
                className={cn(
                  "absolute h-[22px] cursor-grab rounded-md bg-brand/80 hover:bg-brand",
                  dragging?.id === b.record.id && "cursor-grabbing opacity-80"
                )}
                style={{
                  left: LABEL_W + left + shift,
                  width: Math.max(width, DAY_PX / 2),
                  top: (ROW_PX - 22) / 2,
                }}
              />
            </div>
          );
        })}

        {!bars.length && (
          <p className="p-8 text-[13px] text-muted-foreground">
            No dated records. Set a value in “{fromField.name}” and they appear here.
          </p>
        )}
      </div>
    </div>
  );
}
