"use client";
import { useMemo, useState } from "react";
import { FieldMeta, Row, ViewConfig } from "@/core/types";
import { Cell } from "../cells/Cell";
import { cn } from "@/lib/utils";

export function KanbanView({
  fields,
  rows,
  view,
  onUpdateCell,
}: {
  fields: FieldMeta[];
  rows: Row[];
  view: ViewConfig;
  onUpdateCell?: (rowIds: string[], fieldId: string, value: unknown) => void;
}) {
  const groupField = fields.find((f) => f.id === view.groupBy) ?? fields.find((f) => f.type === "status" || f.type === "singleSelect");
  const titleField = fields.find((f) => f.id === view.titleField) ?? fields.find((f) => f.type === "text");
  const [overLane, setOverLane] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Card fields: skip hidden, group/title, json blobs, and fields whose value
  // never varies (no signal on a card).
  const cardFields = useMemo(() => {
    const candidates = fields.filter(
      (f) => !f.hidden && f.id !== groupField?.id && f.id !== titleField?.id && f.type !== "json"
    );
    const varying = candidates.filter(
      (f) => new Set(rows.map((r) => String(r[f.id] ?? ""))).size > 1
    );
    return (varying.length ? varying : candidates).slice(0, 3);
  }, [fields, rows, groupField, titleField]);

  const lanes = useMemo(() => {
    if (!groupField) return [];
    const optionOrder = groupField.options?.map((o) => o.value) ?? [];
    const map = new Map<string, Row[]>();
    for (const v of optionOrder) map.set(v, []);
    for (const r of rows) {
      const key = String(r[groupField.id] ?? "—");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [rows, groupField]);

  if (!groupField)
    return (
      <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
        This dataset has no status-like field to group by.
      </div>
    );

  const canDrag = Boolean(onUpdateCell);

  const handleDrop = (e: React.DragEvent, lane: string) => {
    e.preventDefault();
    setOverLane(null);
    setDragging(false);
    const rowId = e.dataTransfer.getData("text/plain");
    if (!rowId || !onUpdateCell) return;
    const row = rows.find((r) => r.__id === rowId);
    if (!row || String(row[groupField.id] ?? "—") === lane) return;
    onUpdateCell([rowId], groupField.id, lane);
  };

  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-4">
      {lanes.map(([lane, laneRows]) => {
        const opt = groupField.options?.find((o) => o.value === lane);
        const droppable = canDrag && lane !== "—";
        return (
          <div
            key={lane}
            onDragOver={droppable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverLane(lane); } : undefined}
            onDragLeave={droppable ? () => setOverLane((l) => (l === lane ? null : l)) : undefined}
            onDrop={droppable ? (e) => handleDrop(e, lane) : undefined}
            className={cn(
              "w-[300px] shrink-0 rounded-xl border bg-muted/40 transition-shadow",
              overLane === lane && "ring-2 ring-brand/60"
            )}
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <span
                className="text-[12px] font-bold uppercase tracking-wide"
                style={{ color: opt ? `var(--c-${opt.color}-fg)` : "hsl(var(--muted-foreground))" }}
              >
                {lane}
              </span>
              <span className="font-mono-data text-[11px] text-muted-foreground">{laneRows.length}</span>
            </div>
            <div className="flex max-h-[calc(100vh-15rem)] flex-col gap-2 overflow-y-auto p-2 pt-0">
              {laneRows.map((r) => (
                <div
                  key={r.__id}
                  draggable={canDrag}
                  onDragStart={
                    canDrag
                      ? (e) => {
                          e.dataTransfer.setData("text/plain", r.__id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging(true);
                        }
                      : undefined
                  }
                  onDragEnd={canDrag ? () => { setDragging(false); setOverLane(null); } : undefined}
                  className={cn(
                    "rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-brand/40",
                    canDrag && "cursor-grab active:cursor-grabbing",
                    dragging && "select-none"
                  )}
                >
                  {titleField && (
                    <div className="mb-1.5 text-[13.5px] font-semibold">
                      {String(r[titleField.id] ?? "Untitled")}
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    {cardFields.map((f) => (
                      <div key={f.id} className="flex items-baseline gap-2 text-[12px]">
                        <span className="w-24 shrink-0 truncate text-[10.5px] uppercase tracking-wider text-muted-foreground">
                          {f.displayName}
                        </span>
                        <Cell field={f} value={r[f.id]} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {laneRows.length === 0 && (
                <div
                  className={cn(
                    "rounded-lg border border-dashed px-2 py-6 text-center text-[11px] text-muted-foreground/70",
                    overLane === lane && "border-brand/60 text-brand"
                  )}
                >
                  {canDrag ? "Drop here" : "Empty"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
