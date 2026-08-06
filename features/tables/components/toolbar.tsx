"use client";

import * as React from "react";
import {
  ArrowDownUp,
  Download,
  Eye,
  EyeOff,
  Filter as FilterIcon,
  Group as GroupIcon,
  GripVertical,
  Lock,
  Palette,
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
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { initialsFromLabel } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import {
  isFilterGroup,
  OPTION_PALETTE,
  PALETTE_HEX,
  type Field,
  type FilterNode,
  type SortSpec,
  type View,
} from "../types";
import type { PresenceUser } from "../use-realtime";
import { ROW_HEIGHT_LABELS, type RowHeight } from "./grid";
import { FilterBuilder } from "./filter-builder";

export type { RowHeight };

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

  /** New field order, per view. Ids in their new order. */
  onReorder: (orderedIds: string[]) => void;

  /** The fields the view groups by, outermost first (max 3). Empty = ungrouped. */
  groupBys: { fieldId: string; dir: "asc" | "desc" }[];
  onGroupBysChange: (next: { fieldId: string; dir: "asc" | "desc" }[]) => void;

  rowHeight: RowHeight;
  onRowHeightChange: (h: RowHeight) => void;

  /** The single-select/status field whose option colours tint each row. null = off. */
  colorFieldId: string | null;
  onColorFieldChange: (fieldId: string | null) => void;

  /** Conditional colour rules — first match wins, evaluated in SQL. Max 5.
   *  Take precedence over colorFieldId. */
  colorRules: { filter: FilterNode; color: string }[];
  onColorRulesChange: (next: { filter: FilterNode; color: string }[]) => void;

  /** Everyone else with this table open right now. */
  presence?: PresenceUser[];

  search: string;
  onSearchChange: (s: string) => void;

  canEditConfig: boolean;
  onExport: () => void;
  onAddField: () => void;
  /** Undo/redo buttons, rendered by the workspace which owns the command stack. */
  undo?: React.ReactNode;
}

const ROW_HEIGHTS = (Object.entries(ROW_HEIGHT_LABELS) as [RowHeight, string][]).map(
  ([value, label]) => ({ value, label })
);

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
    onReorder,
    groupBys,
    onGroupBysChange,
    rowHeight,
    onRowHeightChange,
    colorFieldId,
    onColorFieldChange,
    colorRules,
    onColorRulesChange,
    presence,
    search,
    onSearchChange,
    canEditConfig,
    onExport,
    onAddField,
    undo,
  } = props;

  const filterCount = countLeaves(filter);
  const hiddenCount = hidden.size;

  /** What can be grouped.
   *
   *  The same list swamp_group_counts enforces. A group is only useful if you can
   *  then ask for its rows, and that ask is an `eq` filter — which is not a
   *  membership test on a multiSelect or a link. If these two ever drift, the
   *  database wins and the user gets an error rather than a wrong answer. */
  const groupable = React.useMemo(
    () =>
      fields.filter((f) =>
        [
          "text", "longText", "email", "phone", "url", "uuid", "color",
          "singleSelect", "status", "boolean",
          "number", "currency", "percent", "rating", "year", "duration",
          "date", "datetime", "time",
          "formula", "lookup", "rollup", "count",
          "createdBy", "modifiedBy", "createdTime", "modifiedTime",
        ].includes(f.type)
      ),
    [fields]
  );

  /** Rows can be tinted by a select/status field's own option colours. Only those
   *  two types carry a colour per value, so only they can drive it. */
  const colorable = React.useMemo(
    () => fields.filter((f) => f.type === "singleSelect" || f.type === "status"),
    [fields]
  );
  const colorFieldName = colorFieldId
    ? fields.find((f) => f.id === colorFieldId)?.name
    : null;

  /** The field being dragged in the Fields list, if any. */
  const [dragging, setDragging] = React.useState<string | null>(null);

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

      {/* Group — up to three nested levels, like NocoDB. */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px]">
            <GroupIcon className="size-3.5" />
            Group
            {groupBys.length > 0 && (
              <span className="max-w-32 truncate rounded bg-muted px-1 text-[11px]">
                {groupBys
                  .map((g) => fields.find((f) => f.id === g.fieldId)?.name ?? "?")
                  .join(" › ")}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[12px] text-muted-foreground">Group by</span>
            {groupBys.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                disabled={!canEditConfig}
                onClick={() => onGroupBysChange([])}
              >
                Clear
              </Button>
            )}
          </div>

          {groupBys.map((g, i) => (
            <div key={g.fieldId} className="mb-1.5 flex items-center gap-1">
              <Select
                value={g.fieldId}
                onValueChange={(v) =>
                  onGroupBysChange(
                    groupBys.map((x, j) => (j === i ? { ...x, fieldId: v } : x))
                  )
                }
                disabled={!canEditConfig}
              >
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupable
                    // A field can hold one level, not two.
                    .filter(
                      (f) => f.id === g.fieldId || !groupBys.some((x) => x.fieldId === f.id)
                    )
                    .map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                variant={g.dir === "asc" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2 text-[11px]"
                disabled={!canEditConfig}
                onClick={() =>
                  onGroupBysChange(
                    groupBys.map((x, j) =>
                      j === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x
                    )
                  )
                }
                title="Direction"
              >
                {g.dir === "asc" ? "A→Z" : "Z→A"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-1.5 text-muted-foreground"
                disabled={!canEditConfig}
                onClick={() => onGroupBysChange(groupBys.filter((_, j) => j !== i))}
                aria-label="Remove level"
              >
                ×
              </Button>
            </div>
          ))}

          {groupBys.length < 3 && (
            <Select
              value=""
              onValueChange={(v) =>
                v && onGroupBysChange([...groupBys, { fieldId: v, dir: "asc" }])
              }
              disabled={!canEditConfig}
            >
              <SelectTrigger className="h-8">
                <SelectValue
                  placeholder={groupBys.length ? "Add a level" : "Pick a field"}
                />
              </SelectTrigger>
              <SelectContent>
                {groupable.filter((f) => !groupBys.some((x) => x.fieldId === f.id))
                  .length === 0 && (
                  <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
                    Nothing groupable in this view
                  </p>
                )}
                {groupable
                  .filter((f) => !groupBys.some((x) => x.fieldId === f.id))
                  .map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}

          <p className="px-1 pt-2 text-[11px] text-muted-foreground">
            Top-level groups count every matching record, not just the ones loaded.
          </p>
        </PopoverContent>
      </Popover>

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

          {/* Drag to reorder. Native HTML5 drag, like kanban.tsx — the one drag in
              the codebase already — rather than a new dependency for one list. */}
          <div className="max-h-72 overflow-auto">
            {fields.map((f, i) => (
              <label
                key={f.id}
                onDragOver={(e) => {
                  if (!dragging || dragging === f.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragging || dragging === f.id) return;
                  const ids = fields.map((x) => x.id);
                  const from = ids.indexOf(dragging);
                  if (from === -1) return;
                  ids.splice(from, 1);
                  // Recompute the target index AFTER the removal, or dragging a
                  // field downwards lands it one place short of where it was let go.
                  ids.splice(ids.indexOf(f.id) + (from < i ? 1 : 0), 0, dragging);
                  onReorder(ids);
                  setDragging(null);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted",
                  f.isPrimary && "opacity-60",
                  dragging === f.id && "opacity-40"
                )}
              >
                {/* The GRIP is the drag handle, not the whole row.
                    Making the <label> draggable broke the checkbox inside it — the
                    browser treats the mousedown as a possible drag start and the
                    toggle never fires, so you could reorder fields but no longer
                    hide one. NocoDB drags by the grip too (FieldsMenu.vue). */}
                {canEditConfig && (
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragging(f.id);
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox refuses to start a drag with no payload.
                      e.dataTransfer.setData("text/plain", f.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className="shrink-0 cursor-grab active:cursor-grabbing"
                    aria-label={`Reorder ${f.name}`}
                  >
                    <GripVertical className="size-3 text-muted-foreground/50" />
                  </span>
                )}
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

      {/* Colour */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px]">
            <Palette className="size-3.5" />
            Colour
            {colorFieldName && (
              <span className="max-w-24 truncate rounded bg-muted px-1 text-[11px]">
                {colorFieldName}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[12px] text-muted-foreground">Colour rows by</span>
            {colorFieldId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                disabled={!canEditConfig}
                onClick={() => onColorFieldChange(null)}
              >
                Clear
              </Button>
            )}
          </div>

          <Select
            value={colorFieldId ?? ""}
            onValueChange={(v) => onColorFieldChange(v || null)}
            disabled={!canEditConfig}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a field" />
            </SelectTrigger>
            <SelectContent>
              {colorable.length === 0 && (
                <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
                  Add a single-select or status field to colour by
                </p>
              )}
              {colorable.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="px-1 pt-2 text-[11px] text-muted-foreground">
            Each row takes the colour of its option — the same colours as the pills.
          </p>

          {/* Conditional rules — first match wins, decided in SQL. They beat the
              option tint above. */}
          <div className="mt-3 border-t pt-2">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <span className="text-[12px] text-muted-foreground">Colour when…</span>
              {colorRules.length < 5 && fields.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  disabled={!canEditConfig}
                  onClick={() =>
                    onColorRulesChange([
                      ...colorRules,
                      { filter: { op: "and", children: [] }, color: OPTION_PALETTE[colorRules.length % OPTION_PALETTE.length] },
                    ])
                  }
                >
                  Add rule
                </Button>
              )}
            </div>

            {colorRules.map((rule, i) => (
              <div key={i} className="mb-2 rounded-md border p-1.5">
                <div className="mb-1 flex items-center gap-1.5">
                  <Select
                    value={rule.color}
                    onValueChange={(c) =>
                      onColorRulesChange(
                        colorRules.map((r, j) => (j === i ? { ...r, color: c } : r))
                      )
                    }
                    disabled={!canEditConfig}
                  >
                    <SelectTrigger className="h-7 w-28 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPTION_PALETTE.map((c) => (
                        <SelectItem key={c} value={c}>
                          <span className="flex items-center gap-1.5">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ background: PALETTE_HEX[c] }}
                            />
                            {c}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-1.5 text-muted-foreground"
                    disabled={!canEditConfig}
                    onClick={() => onColorRulesChange(colorRules.filter((_, j) => j !== i))}
                    aria-label="Remove rule"
                  >
                    ×
                  </Button>
                </div>
                <FilterBuilder
                  fields={fields}
                  value={rule.filter}
                  onChange={(next) =>
                    onColorRulesChange(
                      colorRules.map((r, j) =>
                        j === i ? { ...r, filter: next ?? { op: "and", children: [] } } : r
                      )
                    )
                  }
                />
              </div>
            ))}
          </div>
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

      {/* Right cluster: who's here, then search. Full width (its own row) when the
          toolbar is cramped; pinned right once there's room, so it never crowds the
          button cluster. */}
      <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
        {presence && presence.length > 0 && (
          <div className="flex items-center -space-x-1.5" title="Here now">
            {presence.slice(0, 5).map((u) => (
              <Avatar
                key={u.userId}
                className="size-6 border-2 border-background"
                title={u.label}
              >
                <AvatarFallback
                  className="text-[10px] font-medium text-white"
                  style={{ backgroundColor: u.color }}
                >
                  {initialsFromLabel(u.label)}
                </AvatarFallback>
              </Avatar>
            ))}
            {presence.length > 5 && (
              <span className="pl-2.5 text-[11px] tabular-nums text-muted-foreground">
                +{presence.length - 5}
              </span>
            )}
          </div>
        )}

        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-7 text-[13px]"
          />
        </div>
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
