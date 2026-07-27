"use client";

import * as React from "react";
import { toast } from "sonner";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronUp, Copy, CopyPlus, Trash2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/shared/ui/resizable";
import { cn } from "@/shared/lib/utils";
import { isReadOnlyField, type Field, type Record_ } from "../types";
import { CellView } from "./cell";
import { RecordSidebar } from "./record-sidebar";

// ════════════════════════════════════════════════════════════════════════════
// The expanded record.
//
// The old app's closest equivalent was a side-panel form you reached by selecting
// exactly one row and clicking Edit — and it was the ONLY way to edit any field
// except a select. Now that cells are editable inline, this is what it should
// always have been: a focused view of one record, with prev/next so you can walk
// a filtered set without going back to the grid each time.
//
// Hidden fields are collapsed rather than dropped. A field hidden from the grid
// is hidden for scanning, not for editing — and someone who opens a record
// usually wants everything.
// ════════════════════════════════════════════════════════════════════════════

export function ExpandedRecord({
  open,
  onOpenChange,
  fields,
  hidden,
  records,
  index,
  onIndexChange,
  onUpdateCell,
  onDelete,
  onDuplicate,
  tableId,
  onLinksChanged,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: Field[];
  hidden: Set<string>;
  records: Record_[];
  index: number;
  onIndexChange: (next: number) => void;
  onUpdateCell: (recordId: string, key: string, value: unknown) => void;
  onDelete: (id: string) => void;
  /** Clone this record. The caller decides where the copy lands; everything
   *  un-copyable is dropped server-side by sanitizeValues, which already refuses
   *  every read-only type. */
  onDuplicate?: (record: Record_) => void;
  tableId: string;
  onLinksChanged: () => void;
  currentUserId: string;
}) {
  const record = records[index];
  const [showHidden, setShowHidden] = React.useState(false);
  const reduceMotion = useReducedMotion();

  const visible = fields.filter((f) => !hidden.has(f.id));
  const collapsed = fields.filter((f) => hidden.has(f.id));

  const primary = fields.find((f) => f.isPrimary);
  const title = primary && record ? String(record.data[primary.key] ?? "") : "";

  // Prev/next walk the LOADED window — which is the filtered, sorted set the user
  // is actually looking at, not the raw table. That's the right set: stepping
  // through a filtered view should stay inside the filter.
  const canPrev = index > 0;
  const canNext = index < records.length - 1;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" && canPrev) onIndexChange(index - 1);
      if (e.key === "ArrowDown" && canNext) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, canPrev, canNext, onIndexChange]);

  if (!record) return null;

  const copyUrl = () => {
    const url = `${window.location.origin}${window.location.pathname}?record=${record.id}`;
    void navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl [&>button]:hidden">
        <div className="flex items-center gap-1 border-b px-4 py-2.5">
          <DialogTitle className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {title || <span className="text-muted-foreground">Untitled</span>}
          </DialogTitle>

          <span className="shrink-0 px-1 text-[12px] tabular-nums text-muted-foreground">
            {index + 1} / {records.length}
          </span>

          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            disabled={!canPrev}
            onClick={() => onIndexChange(index - 1)}
            aria-label="Previous record"
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            disabled={!canNext}
            onClick={() => onIndexChange(index + 1)}
            aria-label="Next record"
          >
            <ChevronDown className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={copyUrl}
            aria-label="Copy link to this record"
          >
            <Copy className="size-3.5" />
          </Button>
          {onDuplicate && (
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0"
              onClick={() => {
                onDuplicate(record);
                onOpenChange(false);
              }}
              aria-label="Duplicate record"
            >
              <CopyPlus className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0 text-destructive"
            onClick={() => {
              onDelete(record.id);
              onOpenChange(false);
            }}
            aria-label="Delete record"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Two panes the reader can rebalance: the fields on the left, the
            comments/history rail on the right. The split is draggable via the
            resizable primitive rather than a hard-coded w-80 — a record with long
            comments and one with many fields want different balances. */}
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={64} minSize={42} className="min-w-0">
            <div className="h-full overflow-auto px-4 py-3">
              {/* Record-panel presence: stepping prev/next remounts this on the
                  record id, so the new record's fields fade+rise in rather than
                  snapping. Reduced-motion users get the swap instantly. */}
              <motion.div
                key={record.id}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: [0.22, 0.8, 0.24, 1] }}
              >
                <div className="flex flex-col gap-3">
                  {visible.map((f) => (
                    <FieldRow
                      key={f.id}
                      field={f}
                      value={record.data[f.key]}
                      onChange={(v) => onUpdateCell(record.id, f.key, v)}
                      recordId={record.id}
                      tableId={tableId}
                      onLinksChanged={onLinksChanged}
                    />
                  ))}
                </div>

                {collapsed.length > 0 && (
                  <div className="mt-4 border-t pt-3">
                    <button
                      onClick={() => setShowHidden((s) => !s)}
                      className="text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      {showHidden ? "Hide" : "Show"} {collapsed.length} hidden{" "}
                      {collapsed.length === 1 ? "field" : "fields"}
                    </button>

                    {showHidden && (
                      <div className="mt-3 flex flex-col gap-3">
                        {collapsed.map((f) => (
                          <FieldRow
                            key={f.id}
                            field={f}
                            value={record.data[f.key]}
                            onChange={(v) => onUpdateCell(record.id, f.key, v)}
                            recordId={record.id}
                            tableId={tableId}
                            onLinksChanged={onLinksChanged}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={36} minSize={22} maxSize={55} className="min-w-0">
            <RecordSidebar
              recordId={record.id}
              fields={fields}
              currentUserId={currentUserId}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  recordId,
  tableId,
  onLinksChanged,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  recordId: string;
  tableId: string;
  onLinksChanged: () => void;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-3">
      <label
        className={cn(
          "truncate pt-1 text-[13px] text-muted-foreground",
          isReadOnlyField(field.type) && "italic"
        )}
        title={field.name}
      >
        {field.name}
      </label>

      <div className="min-w-0 rounded-md border px-2 py-1">
        <CellView
          field={field}
          value={value}
          onChange={onChange}
          recordId={recordId}
          tableId={tableId}
          onLinksChanged={onLinksChanged}
        />
      </div>
    </div>
  );
}
