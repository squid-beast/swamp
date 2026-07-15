"use client";

import * as React from "react";
import {
  ArrowDownUp,
  Download,
  Eye,
  EyeOff,
  Filter as FilterIcon,
  Lock,
  Plus,
  Rows3,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import {
  isFilterGroup,
  type Field,
  type FilterNode,
  type SortSpec,
  type View,
} from "../types";
import { FilterBuilder } from "./filter-builder";

// The toolbar. Every control writes straight through to the view.
//
// Changing a filter here changes the VIEW, for everyone, immediately — no Save
// button, no unsaved state. That's what Airtable does and it's what people
// expect: a filter you set is a filter that's set.
//
// Counting conditions for the badge means walking the tree, since a group node
// isn't a condition — it's a container.
function countLeaves(node: FilterNode | null): number {
  if (!node) return 0;
  if (!isFilterGroup(node)) return 1;
  return node.children.reduce((n, c) => n + countLeaves(c), 0);
}

export type RowHeight = "short" | "medium" | "tall" | "extra";

export interface ToolbarProps {
  fields: Field[];
  views: View[];
  view: View;
  /** The view switcher + actions menu, rendered by the workspace. */
  viewMenu?: React.ReactNode;

  filter: FilterNode | null;
  onFilterChange: (next: FilterNode | null) => void;

  sorts: SortSpec[];
  onSortsChange: (next: SortSpec[]) => void;

  hidden: Set<string>; // field ids
  onHiddenChange: (next: Set<string>) => void;

  rowHeight: RowHeight;
  onRowHeightChange: (h: RowHeight) => void;

  search: string;
  onSearchChange: (s: string) => void;

  canEditConfig: boolean;
  onExport: () => void;
  onAddField: () => void;
  /** Undo/redo buttons, rendered by the workspace which owns the command stack. */
  undo?: React.ReactNode;
}

const ROW_HEIGHTS: { value: RowHeight; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "tall", label: "Tall" },
  { value: "extra", label: "Extra tall" },
];

export function Toolbar(props: ToolbarProps) {
  const {
    fields,
    views,
    view,
    viewMenu,
    filter,
    onFilterChange,
    sorts,
    onSortsChange,
    hidden,
    onHiddenChange,
    rowHeight,
    onRowHeightChange,
    search,
    onSearchChange,
    canEditConfig,
    onExport,
    onAddField,
    undo,
  } = props;

  const filterCount = countLeaves(filter);
  const hiddenCount = hidden.size;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
      {undo}

      {viewMenu}

      {/* A locked view is read-only config, not read-only data. The distinction
          matters: you can still edit records, you just can't move the goalposts
          for everyone else. */}
      {!canEditConfig && (
        <span
          className="flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground"
          title="This view is locked. You can still edit records."
        >
          <Lock className="size-3" />
          Locked
        </span>
      )}

      {/* Fields */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px]">
            {hiddenCount ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            Fields
            {hiddenCount > 0 && (
              <span className="rounded bg-muted px-1 text-[11px] tabular-nums">
                {hiddenCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[12px] text-muted-foreground">Visible fields</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                disabled={!canEditConfig}
                onClick={() => onHiddenChange(new Set())}
              >
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                disabled={!canEditConfig}
                onClick={() =>
                  // The primary field always stays. A grid with no display value
                  // is a grid of anonymous rows.
                  onHiddenChange(
                    new Set(fields.filter((f) => !f.isPrimary).map((f) => f.id))
                  )
                }
              >
                None
              </Button>
            </div>
          </div>

          <div className="max-h-72 overflow-auto">
            {fields.map((f) => (
              <label
                key={f.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted",
                  f.isPrimary && "opacity-60"
                )}
              >
                <input
                  type="checkbox"
                  checked={!hidden.has(f.id)}
                  disabled={f.isPrimary || !canEditConfig}
                  onChange={(e) => {
                    const next = new Set(hidden);
                    if (e.target.checked) next.delete(f.id);
                    else next.add(f.id);
                    onHiddenChange(next);
                  }}
                />
                <span className="truncate">{f.name}</span>
                {f.isPrimary && (
                  <span className="ml-auto text-[10px] text-muted-foreground">primary</span>
                )}
              </label>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-1.5 text-[13px]"
            onClick={onAddField}
          >
            <Plus className="size-3.5" />
            New field
          </Button>
        </PopoverContent>
      </Popover>

      {/* Filters */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 gap-1.5 text-[13px]", filterCount && "bg-muted")}
          >
            <FilterIcon className="size-3.5" />
            Filter
            {filterCount > 0 && (
              <span className="rounded bg-brand/15 px-1 text-[11px] tabular-nums text-brand">
                {filterCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0">
          {canEditConfig ? (
            <FilterBuilder fields={fields} value={filter} onChange={onFilterChange} />
          ) : (
            <p className="p-3 text-[13px] text-muted-foreground">
              This view is locked. Unlock it to change the filters.
            </p>
          )}
        </PopoverContent>
      </Popover>

      {/* Sorts */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 gap-1.5 text-[13px]", sorts.length && "bg-muted")}
          >
            <ArrowDownUp className="size-3.5" />
            Sort
            {sorts.length > 0 && (
              <span className="rounded bg-brand/15 px-1 text-[11px] tabular-nums text-brand">
                {sorts.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[26rem] p-2">
          <SortEditor
            fields={fields}
            sorts={sorts}
            onChange={onSortsChange}
            disabled={!canEditConfig}
          />
        </PopoverContent>
      </Popover>

      {/* Row height */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px]">
            <Rows3 className="size-3.5" />
            Height
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-40 p-1">
          {ROW_HEIGHTS.map((h) => (
            <button
              key={h.value}
              onClick={() => onRowHeightChange(h.value)}
              className={cn(
                "block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                rowHeight === h.value && "bg-muted font-medium"
              )}
            >
              {h.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-[13px]"
        onClick={onExport}
        title="Export what this view shows, as CSV"
      >
        <Download className="size-3.5" />
        Export
      </Button>

      <div className="relative ml-auto w-56">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="h-8 pl-7 text-[13px]"
        />
      </div>
    </div>
  );
}

function SortEditor({
  fields,
  sorts,
  onChange,
  disabled,
}: {
  fields: Field[];
  sorts: SortSpec[];
  onChange: (next: SortSpec[]) => void;
  disabled: boolean;
}) {
  const used = new Set(sorts.map((s) => s.field));
  const available = fields.filter((f) => !used.has(f.key));

  return (
    <div className="flex flex-col gap-1.5">
      {sorts.length === 0 && (
        <p className="px-1 py-2 text-[13px] text-muted-foreground">No sorts.</p>
      )}

      {sorts.map((s, i) => {
        const field = fields.find((f) => f.key === s.field);
        return (
          <div key={s.field} className="flex items-center gap-1.5">
            {/* Precedence is the list order and it's worth showing. "Sort by
                status, then by amount" is a different result from the reverse,
                and a flat list of chips hides that. */}
            <span className="w-10 shrink-0 px-1 text-[12px] text-muted-foreground">
              {i === 0 ? "Sort" : "then"}
            </span>

            <Select
              value={s.field}
              disabled={disabled}
              onValueChange={(key) => {
                const next = [...sorts];
                next[i] = { ...next[i], field: key };
                onChange(next);
              }}
            >
              <SelectTrigger className="h-8 flex-1 text-[13px]">
                <SelectValue>{field?.name ?? "Missing field"}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={s.dir}
              disabled={disabled}
              onValueChange={(dir) => {
                const next = [...sorts];
                next[i] = { ...next[i], dir: dir as "asc" | "desc" };
                onChange(next);
              }}
            >
              <SelectTrigger className="h-8 w-24 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">A → Z</SelectItem>
                <SelectItem value="desc">Z → A</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-muted-foreground"
              disabled={disabled}
              onClick={() => onChange(sorts.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="sm"
        className="mt-1 justify-start gap-1.5 text-[13px]"
        disabled={disabled || !available.length}
        onClick={() => onChange([...sorts, { field: available[0].key, dir: "asc" }])}
      >
        <Plus className="size-3.5" />
        Add sort
      </Button>
    </div>
  );
}
