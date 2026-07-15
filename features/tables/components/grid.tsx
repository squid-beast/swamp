"use client";

import * as React from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { GripVertical, Loader2, Maximize2, Plus, Settings2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { isReadOnlyField, type Field, type Record_ } from "../types";
import { inRange, type CellRef, type Range as CellRange } from "../use-grid";
import { CellView } from "./cell";

// ════════════════════════════════════════════════════════════════════════════
// The grid.
//
// Virtualized (only the visible window is in the DOM) and server-paged (it never
// sees the whole table). Filtering and sorting happen in Postgres; the grid does
// not own a copy of the data it could filter.
//
// ── DOM, not canvas ──
//
// The reference implementation paints to a <canvas> and keeps DOM only for the
// active cell's editor. That's genuinely faster, and it's where this ends up if a
// real dataset makes the DOM stutter. It is not where we start: a virtualized DOM
// grid is far quicker to build, debuggable in devtools, accessible for free, and
// reachable by Playwright. The cell renderer sits behind a narrow interface so a
// canvas renderer can be swapped in later without touching anything above it.
// ════════════════════════════════════════════════════════════════════════════

const ROW_HEIGHTS = { short: 36, medium: 56, tall: 88, extra: 128 } as const;
export type RowHeight = keyof typeof ROW_HEIGHTS;

const GUTTER_WIDTH = 88;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 80;
const PREFETCH_ROWS = 20;

export interface GridProps {
  fields: Field[];
  records: Record_[];
  total: number | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  rowHeight: RowHeight;
  widths: Map<string, number>;

  onLoadMore: () => void;
  onAddRecord: () => void;
  onExpand: (recordId: string) => void;
  onEditField: (field: Field) => void;
  onResizeField: (fieldId: string, width: number) => void;
  tableId: string;
  onLinksChanged: () => void;

  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;

  // Interaction, owned by useGrid.
  active: CellRef | null;
  setActive: (c: CellRef | null) => void;
  range: CellRange | null;
  setRange: (r: CellRange | null) => void;
  editing: boolean;
  setEditing: (e: boolean) => void;

  onKeyDown: (e: React.KeyboardEvent) => void;
  onPaste: (text: string) => void;
  onSetCell: (row: number, col: number, value: unknown) => void;
  onCommitFill: (target: CellRange) => void;
  onDeleteRecords: (ids: string[]) => void;
  onMoveRecord: (from: number, to: number) => void;
}

export function Grid(props: GridProps) {
  const {
    fields,
    records,
    total,
    loading,
    loadingMore,
    hasMore,
    rowHeight,
    widths,
    onLoadMore,
    onAddRecord,
    onExpand,
    onEditField,
    onResizeField,
    tableId,
    onLinksChanged,
    selected,
    onSelectedChange,
    active,
    setActive,
    range,
    setRange,
    editing,
    setEditing,
    onKeyDown,
    onPaste,
    onSetCell,
    onCommitFill,
    onDeleteRecords,
    onMoveRecord,
  } = props;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowPx = ROW_HEIGHTS[rowHeight] ?? ROW_HEIGHTS.short;

  // Drag state. Refs, not state: these fire on every mousemove, and a setState per
  // pixel would make the drag feel like treacle.
  const selecting = React.useRef(false);
  const filling = React.useRef(false);
  const [fillTarget, setFillTarget] = React.useState<CellRange | null>(null);
  const [dragRow, setDragRow] = React.useState<number | null>(null);
  const [dropRow, setDropRow] = React.useState<number | null>(null);
  const resizing = React.useRef<{ fieldId: string; startX: number; startW: number } | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowPx,
    overscan: 12,
  });

  React.useEffect(() => {
    rowVirtualizer.measure();
  }, [rowPx, rowVirtualizer]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  const last = virtualRows[virtualRows.length - 1];
  React.useEffect(() => {
    if (!last || !hasMore || loadingMore || loading) return;
    if (last.index >= records.length - PREFETCH_ROWS) onLoadMore();
  }, [last, hasMore, loadingMore, loading, records.length, onLoadMore]);

  // ── Global mouse handlers for the drags ──
  //
  // On window, not on the cell: a drag that leaves the grid and comes back must
  // still be a drag, and a mouseup outside the grid must still end it. Bound to
  // the cell, a fast drag out of the viewport leaves the grid stuck in select mode.
  React.useEffect(() => {
    const onUp = () => {
      if (filling.current && fillTarget) onCommitFill(fillTarget);
      selecting.current = false;
      filling.current = false;
      resizing.current = null;
      setFillTarget(null);
    };

    const onMove = (e: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      const width = Math.max(MIN_COL_WIDTH, r.startW + (e.clientX - r.startX));
      onResizeField(r.fieldId, width);
    };

    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
    };
  }, [fillTarget, onCommitFill, onResizeField]);

  const widthOf = (f: Field) => widths.get(f.id) ?? DEFAULT_COL_WIDTH;

  const gridTemplate = `${GUTTER_WIDTH}px ${fields
    .map((f) => `${widthOf(f)}px`)
    .join(" ")}`;

  const allSelected = records.length > 0 && selected.size === records.length;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text/plain");
          if (!text) return;
          e.preventDefault();
          onPaste(text);
        }}
        className="relative min-h-0 flex-1 overflow-auto border-t outline-none"
        data-testid="grid-scroll"
      >
        {/* Header */}
        <div
          className="sticky top-0 z-20 grid border-b bg-muted/50 backdrop-blur"
          style={{ gridTemplateColumns: gridTemplate, width: "max-content", minWidth: "100%" }}
        >
          <div className="flex items-center justify-center border-r px-2 py-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(v) =>
                onSelectedChange(v ? new Set(records.map((r) => r.id)) : new Set())
              }
              aria-label="Select all loaded rows"
            />
          </div>

          {fields.map((f) => (
            <div
              key={f.id}
              className="group relative flex items-center border-r"
              data-testid="grid-header"
            >
              <button
                onClick={() => onEditField(f)}
                className="flex min-w-0 flex-1 items-center gap-1 px-3 py-2 text-left text-[13px] font-medium hover:bg-muted"
                title={`${f.name} — click to edit`}
              >
                <span className="truncate">{f.name}</span>
                <Settings2 className="ml-auto size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>

              {/* Resize grip. -right-1 so the hit area straddles the border —
                  a 1px target is a target nobody hits. */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  resizing.current = {
                    fieldId: f.id,
                    startX: e.clientX,
                    startW: widthOf(f),
                  };
                }}
                onDoubleClick={() => onResizeField(f.id, DEFAULT_COL_WIDTH)}
                className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-brand/40"
                data-testid="col-resize"
              />
            </div>
          ))}
        </div>

        {/* Rows */}
        <div
          style={{ height: rowVirtualizer.getTotalSize(), width: "max-content", minWidth: "100%" }}
          className="relative"
        >
          {virtualRows.map((v: VirtualItem) => {
            const record = records[v.index];
            const isSelected = selected.has(record.id);
            const isDropTarget = dropRow === v.index;

            return (
              <div
                key={record.id}
                className={cn(
                  "group absolute left-0 top-0 grid border-b hover:bg-muted/30",
                  isSelected && "bg-muted/50",
                  dragRow === v.index && "opacity-40",
                  isDropTarget && "border-t-2 border-t-brand"
                )}
                style={{
                  height: v.size,
                  transform: `translateY(${v.start}px)`,
                  gridTemplateColumns: gridTemplate,
                  width: "max-content",
                  minWidth: "100%",
                }}
                onDragOver={(e) => {
                  if (dragRow === null) return;
                  e.preventDefault();
                  setDropRow(v.index);
                }}
                onDrop={() => {
                  if (dragRow !== null && dragRow !== v.index) {
                    onMoveRecord(dragRow, v.index);
                  }
                  setDragRow(null);
                  setDropRow(null);
                }}
                data-testid="grid-row"
              >
                {/* Gutter */}
                <div className="group/gutter flex items-center gap-0.5 border-r px-1.5 text-[12px] tabular-nums text-muted-foreground">
                  <span
                    draggable
                    onDragStart={() => setDragRow(v.index)}
                    onDragEnd={() => {
                      setDragRow(null);
                      setDropRow(null);
                    }}
                    className="cursor-grab opacity-0 group-hover/gutter:opacity-100 active:cursor-grabbing"
                    data-testid="row-handle"
                  >
                    <GripVertical className="size-3" />
                  </span>

                  <span
                    className={cn(
                      "w-5 text-right group-hover/gutter:hidden",
                      isSelected && "hidden"
                    )}
                  >
                    {v.index + 1}
                  </span>
                  <span
                    className={cn(
                      "hidden w-5 justify-end group-hover/gutter:flex",
                      isSelected && "flex"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(record.id)}
                      aria-label={`Select row ${v.index + 1}`}
                    />
                  </span>

                  <button
                    onClick={() => onExpand(record.id)}
                    className="ml-auto opacity-0 group-hover/gutter:opacity-100"
                    aria-label={`Expand row ${v.index + 1}`}
                    data-testid="expand-row"
                  >
                    <Maximize2 className="size-3" />
                  </button>
                </div>

                {/* Cells */}
                {fields.map((f, col) => {
                  const isActive = active?.row === v.index && active?.col === col;
                  const selectedCell =
                    inRange(range, v.index, col) || inRange(fillTarget, v.index, col);
                  const readOnly = isReadOnlyField(f.type);

                  // The fill handle sits on the bottom-right of the selection —
                  // or of the active cell when there's no range.
                  const anchor = range
                    ? {
                        row: Math.max(range.from.row, range.to.row),
                        col: Math.max(range.from.col, range.to.col),
                      }
                    : active;
                  const showHandle =
                    !readOnly && anchor?.row === v.index && anchor?.col === col;

                  return (
                    <ContextMenu key={f.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          onMouseDown={(e) => {
                            if (e.button !== 0) return; // right-click opens the menu, doesn't select
                            setActive({ row: v.index, col });
                            setEditing(false);

                            if (e.shiftKey && active) {
                              setRange({ from: active, to: { row: v.index, col } });
                            } else {
                              setRange(null);
                              selecting.current = true;
                            }
                            scrollRef.current?.focus();
                          }}
                          onMouseEnter={() => {
                            if (selecting.current && active) {
                              setRange({ from: active, to: { row: v.index, col } });
                            }
                            if (filling.current && range) {
                              setFillTarget({
                                from: range.from,
                                to: { row: v.index, col: Math.max(range.from.col, range.to.col) },
                              });
                            }
                          }}
                          onDoubleClick={() => !readOnly && setEditing(true)}
                          className={cn(
                            "relative min-w-0 border-r px-3 py-1.5",
                            rowHeight === "short" ? "flex items-center" : "overflow-hidden",
                            selectedCell && "bg-brand/10",
                            isActive && "z-10 outline outline-2 -outline-offset-2 outline-brand"
                          )}
                          data-testid="grid-cell"
                        >
                          <CellView
                            field={f}
                            value={record.data[f.key]}
                            editing={isActive && editing}
                            onEditingChange={setEditing}
                            onChange={(next) => onSetCell(v.index, col, next)}
                            recordId={record.id}
                            tableId={tableId}
                            onLinksChanged={onLinksChanged}
                          />

                          {showHandle && (
                            <span
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                // A single cell is a range of one — otherwise the
                                // fill has no source to read a series from.
                                if (!range && active) {
                                  setRange({ from: active, to: active });
                                }
                                filling.current = true;
                              }}
                              className="absolute -bottom-[3px] -right-[3px] z-20 size-[7px] cursor-crosshair rounded-[1px] bg-brand"
                              data-testid="fill-handle"
                            />
                          )}
                        </div>
                      </ContextMenuTrigger>

                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => onExpand(record.id)}>
                          Expand record
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={readOnly}
                          onClick={() => onSetCell(v.index, col, null)}
                        >
                          Clear cell
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-destructive"
                          onClick={() => onDeleteRecords([record.id])}
                        >
                          Delete row
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            );
          })}
        </div>

        {loadingMore && (
          <div className="flex items-center justify-center gap-2 py-3 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading more…
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onAddRecord} className="gap-1.5">
          <Plus className="size-3.5" />
          New row
        </Button>

        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
          {/* The total comes from a COUNT(*) through the same filter — not from
              records.length, which is only what's been paged in. Showing the
              loaded count as the total is how the old grid told you a 50,000-row
              table had 5,000 rows. */}
          {records.length.toLocaleString()}
          {total !== null && total !== records.length && ` of ${total.toLocaleString()}`}
          {" rows"}
        </span>
      </div>
    </div>
  );
}
