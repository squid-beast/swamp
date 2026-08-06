"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Field, Record_ } from "../types";
import { CellView } from "./cell";

// List: one record per row, primary field prominent, a few visible fields
// after it. The cheapest of the NocoDB view types — the same virtualizer the
// grid uses, no columns to resize, click opens the record.

const ROW_PX = 52;

export function ListView({
  fields,
  hidden,
  records,
  onExpand,
  onLoadMore,
  hasMore,
  loadingMore,
}: {
  fields: Field[];
  hidden: Set<string>;
  records: Record_[];
  onExpand: (recordId: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const primary = fields.find((f) => f.isPrimary);
  const rest = fields.filter((f) => !hidden.has(f.id) && !f.isPrimary).slice(0, 4);

  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PX,
    overscan: 12,
  });

  const rows = virtualizer.getVirtualItems();
  const last = rows[rows.length - 1];
  React.useEffect(() => {
    if (!last || !hasMore || loadingMore) return;
    if (last.index >= records.length - 20) onLoadMore();
  }, [last, hasMore, loadingMore, records.length, onLoadMore]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div style={{ height: virtualizer.getTotalSize() }} className="relative">
        {rows.map((v) => {
          const r = records[v.index];
          if (!r) return null;
          return (
            <button
              key={r.id}
              onClick={() => onExpand(r.id)}
              className="absolute left-0 top-0 flex w-full items-center gap-4 border-b px-4 text-left hover:bg-muted/40"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {primary ? String(r.data[primary.key] ?? "—") : "—"}
              </span>
              {rest.map((f) => (
                <span
                  key={f.id}
                  className="pointer-events-none hidden w-40 shrink-0 truncate text-[12px] text-muted-foreground sm:block"
                >
                  {/* Display only — the no-op onChange plus pointer-events-none
                      make the cell inert; editing happens in the expanded record. */}
                  <CellView field={f} value={r.data[f.key]} onChange={() => {}} />
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
