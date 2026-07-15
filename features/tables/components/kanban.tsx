"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { Field, Record_ } from "../types";

// ════════════════════════════════════════════════════════════════════════════
// Kanban.
//
// Stacks come from a single-select field's options — PLUS an always-present
// "Uncategorized" stack for records whose value is null or unknown.
//
// ── Stack metadata WILL drift from the options. Reconcile every render. ──
//
// The view stores stack order and collapsed-state keyed by option value. The
// options themselves live on the FIELD, and someone can add, rename or delete one
// at any time — from the field editor, from another view, from another browser.
//
// So the stored stack list and the live option list disagree constantly. The
// reference implementation hit this, patched it, and hit it again; the fix is to
// treat the field's options as the source of truth and derive stacks fresh on
// every render, merging in whatever config we have. Never trust the stored list
// to be complete.
//
// A record whose select value isn't in the options (an option was deleted, or the
// value came from an import) lands in Uncategorized rather than vanishing. A card
// that exists nowhere is worse than a card in the wrong place.
// ════════════════════════════════════════════════════════════════════════════

const UNCATEGORIZED = "__uncategorized__";

export interface KanbanProps {
  fields: Field[];
  hidden: Set<string>;
  records: Record_[];
  stackField: Field;
  collapsed: Set<string>;
  onCollapsedChange: (next: Set<string>) => void;
  onUpdateCell: (recordId: string, key: string, value: unknown) => void;
  onExpand: (recordId: string) => void;
  onAddRecord: (values: Record<string, unknown>) => void;
}

export function Kanban({
  fields,
  hidden,
  records,
  stackField,
  collapsed,
  onCollapsedChange,
  onUpdateCell,
  onExpand,
  onAddRecord,
}: KanbanProps) {
  const [dragging, setDragging] = React.useState<string | null>(null);

  // Derived fresh, every render, from the field's live options. See the note above.
  const stacks = React.useMemo(() => {
    const options = stackField.options.options ?? [];
    const known = new Set(options.map((o) => o.value));

    const buckets = new Map<string, Record_[]>();
    buckets.set(UNCATEGORIZED, []);
    for (const o of options) buckets.set(o.value, []);

    for (const r of records) {
      const raw = r.data[stackField.key];
      const value = raw == null || raw === "" ? null : String(raw);
      const key = value && known.has(value) ? value : UNCATEGORIZED;
      buckets.get(key)!.push(r);
    }

    return [
      { id: UNCATEGORIZED, title: "Uncategorized", color: undefined as string | undefined },
      ...options.map((o) => ({ id: o.value, title: o.value, color: o.color })),
    ].map((s) => ({ ...s, records: buckets.get(s.id) ?? [] }));
  }, [records, stackField]);

  const primary = fields.find((f) => f.isPrimary);
  const cardFields = fields
    .filter((f) => !hidden.has(f.id) && !f.isPrimary && f.id !== stackField.id)
    .slice(0, 3);

  const drop = (stackId: string) => {
    if (!dragging) return;
    onUpdateCell(
      dragging,
      stackField.key,
      stackId === UNCATEGORIZED ? null : stackId
    );
    setDragging(null);
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {stacks.map((stack) => {
        const isCollapsed = collapsed.has(stack.id);

        return (
          <div
            key={stack.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(stack.id)}
            className={cn(
              "flex shrink-0 flex-col rounded-lg border bg-muted/30",
              isCollapsed ? "w-12" : "w-72"
            )}
          >
            <div className="flex items-center gap-1.5 px-2 py-2">
              <button
                onClick={() => {
                  const next = new Set(collapsed);
                  if (next.has(stack.id)) next.delete(stack.id);
                  else next.add(stack.id);
                  onCollapsedChange(next);
                }}
                className="text-muted-foreground"
                aria-label={isCollapsed ? "Expand stack" : "Collapse stack"}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </button>

              {!isCollapsed && (
                <>
                  <span className="truncate text-[13px] font-medium">{stack.title}</span>
                  {/* The count is live and per-stack. A board that doesn't tell you
                      how many are in each column is a board you can't triage with. */}
                  <span className="ml-auto rounded bg-background px-1.5 text-[11px] tabular-nums text-muted-foreground">
                    {stack.records.length}
                  </span>
                </>
              )}
            </div>

            {!isCollapsed && (
              <>
                <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
                  {stack.records.map((r) => (
                    <div
                      key={r.id}
                      draggable
                      onDragStart={() => setDragging(r.id)}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => onExpand(r.id)}
                      className={cn(
                        "cursor-pointer rounded-md border bg-background p-2 text-[13px] shadow-sm hover:border-brand/50",
                        dragging === r.id && "opacity-40"
                      )}
                    >
                      <p className="truncate font-medium">
                        {primary ? String(r.data[primary.key] ?? "") || "Untitled" : "Untitled"}
                      </p>

                      {cardFields.map((f) => {
                        const v = r.data[f.key];
                        if (v == null || v === "") return null;
                        return (
                          <p key={f.id} className="truncate text-[12px] text-muted-foreground">
                            {Array.isArray(v) ? v.join(", ") : String(v)}
                          </p>
                        );
                      })}
                    </div>
                  ))}

                  {stack.records.length === 0 && (
                    <p className="px-1 py-2 text-[12px] text-muted-foreground">Empty</p>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="m-1 justify-start gap-1.5 text-[13px]"
                  // A new card in a stack is pre-filled with that stack's value —
                  // otherwise you add a card to "In progress" and it appears in
                  // Uncategorized, which is baffling.
                  onClick={() =>
                    onAddRecord(
                      stack.id === UNCATEGORIZED ? {} : { [stackField.key]: stack.id }
                    )
                  }
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
