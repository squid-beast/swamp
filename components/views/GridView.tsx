"use client";
import * as React from "react";
import {
  ColumnDef,
  SortingState,
  RowSelectionState,
  VisibilityState,
  Updater,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown, ArrowUp, ChevronsUpDown, ListFilter, SlidersHorizontal, Tag, Trash2, X,
} from "lucide-react";
import { FieldMeta, Row } from "@/core/types";
import { Cell } from "../cells/Cell";
import { SelectCell } from "../cells/SelectCell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

const TYPE_GLYPH: Record<string, string> = {
  text: "Aa", longText: "¶", number: "#", currency: "$", percent: "%",
  boolean: "✓", date: "◷", email: "@", phone: "☎", url: "↗", image: "▣",
  singleSelect: "◉", multiSelect: "⁘", status: "●", json: "{}",
};

const NUMERIC = new Set(["number", "currency", "percent"]);
const EDITABLE_SELECT = new Set(["status", "singleSelect"]);
const parseNum = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? Number.NEGATIVE_INFINITY : n;
};

const optColor = (c: string) => ({ color: `var(--c-${c}-fg)` });

export function GridView({
  fields,
  rows,
  search,
  onToggleHidden,
  onUpdateCell,
  onDeleteRows,
}: {
  fields: FieldMeta[];
  rows: Row[];
  search: string;
  onToggleHidden: (fieldId: string) => void;
  onUpdateCell?: (rowIds: string[], fieldId: string, value: unknown) => void;
  onDeleteRows?: (rowIds: string[]) => void;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [filters, setFilters] = React.useState<Record<string, string[]>>({});

  // Fields that can drive option filters and bulk edits.
  const selectFields = React.useMemo(
    () => fields.filter((f) => !f.hidden && EDITABLE_SELECT.has(f.type) && f.options?.length),
    [fields]
  );

  const filteredRows = React.useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.length > 0);
    if (!active.length) return rows;
    return rows.filter((r) =>
      active.every(([fieldId, values]) => values.includes(String(r[fieldId] ?? "")))
    );
  }, [rows, filters]);

  const activeFilterCount = Object.values(filters).reduce((a, v) => a + v.length, 0);

  const toggleFilter = (fieldId: string, value: string) =>
    setFilters((f) => {
      const cur = f[fieldId] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...f, [fieldId]: next };
    });

  // Column visibility is derived from the persisted field registry (overrides).
  const columnVisibility = React.useMemo<VisibilityState>(
    () => Object.fromEntries(fields.map((f) => [f.id, !f.hidden])),
    [fields]
  );

  const handleVisibilityChange = (updater: Updater<VisibilityState>) => {
    const next = typeof updater === "function" ? updater(columnVisibility) : updater;
    for (const f of fields) {
      const wasVisible = !f.hidden;
      const nowVisible = next[f.id] ?? true;
      if (wasVisible !== nowVisible) onToggleHidden(f.id);
    }
  };

  const columns = React.useMemo<ColumnDef<Row>[]>(() => {
    const select: ColumnDef<Row> = {
      id: "__select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllRowsSelected()
              ? true
              : table.getIsSomeRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
          aria-label="Select all"
          className="translate-y-[1px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
          className="translate-y-[1px]"
        />
      ),
    };

    const fieldCols: ColumnDef<Row>[] = fields.map((f) => ({
      id: f.id,
      accessorFn: (r) => r[f.id],
      enableHiding: true,
      sortingFn: NUMERIC.has(f.type)
        ? (a, b) => parseNum(a.getValue(f.id)) - parseNum(b.getValue(f.id))
        : "alphanumeric",
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <button
            onClick={() => column.toggleSorting(sorted === "asc")}
            className="group/h flex w-full items-center gap-2 whitespace-nowrap text-left"
          >
            <span className="font-mono-data text-[10px] text-muted-foreground/70">
              {TYPE_GLYPH[f.type] ?? "·"}
            </span>
            <span className="font-medium text-muted-foreground group-hover/h:text-foreground">
              {f.displayName}
            </span>
            {sorted === "asc" ? (
              <ArrowUp className="size-3 text-brand" />
            ) : sorted === "desc" ? (
              <ArrowDown className="size-3 text-brand" />
            ) : (
              <ChevronsUpDown className="size-3 text-muted-foreground/0 group-hover/h:text-muted-foreground/50" />
            )}
          </button>
        );
      },
      cell: ({ getValue, row }) =>
        EDITABLE_SELECT.has(f.type) && f.options?.length && onUpdateCell ? (
          <SelectCell
            field={f}
            value={getValue()}
            onChange={(v) => onUpdateCell([row.id], f.id, v)}
          />
        ) : (
          <Cell field={f} value={getValue()} />
        ),
    }));

    return [select, ...fieldCols];
  }, [fields, onUpdateCell]);

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, rowSelection, columnVisibility, globalFilter: search },
    getRowId: (r) => r.__id,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: handleVisibilityChange,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selectedIds = Object.keys(rowSelection);
  const visibleRows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {selectedIds.length > 0 ? (
            <>
              <span className="font-medium text-foreground">{selectedIds.length} selected</span>

              {onUpdateCell && selectFields.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5">
                      <Tag className="size-3.5" />
                      Set status
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {selectFields.map((f) =>
                      selectFields.length === 1 ? (
                        <React.Fragment key={f.id}>
                          <DropdownMenuLabel>{f.displayName}</DropdownMenuLabel>
                          {f.options!.map((o) => (
                            <DropdownMenuItem
                              key={o.value}
                              onSelect={() => {
                                onUpdateCell(selectedIds, f.id, o.value);
                                setRowSelection({});
                              }}
                            >
                              <span
                                className="text-[13px] font-semibold"
                                style={optColor(o.color)}
                              >
                                {o.value}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </React.Fragment>
                      ) : (
                        <DropdownMenuSub key={f.id}>
                          <DropdownMenuSubTrigger>{f.displayName}</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-48">
                            {f.options!.map((o) => (
                              <DropdownMenuItem
                                key={o.value}
                                onSelect={() => {
                                  onUpdateCell(selectedIds, f.id, o.value);
                                  setRowSelection({});
                                }}
                              >
                                <span
                                  className="text-[13px] font-semibold"
                                  style={optColor(o.color)}
                                >
                                  {o.value}
                                </span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {onDeleteRows && (
                <ConfirmDialog
                  title={`Delete ${selectedIds.length} row${selectedIds.length === 1 ? "" : "s"}?`}
                  description="This permanently removes the selected rows from the dataset."
                  confirmLabel={`Delete ${selectedIds.length} row${selectedIds.length === 1 ? "" : "s"}`}
                  onConfirm={() => {
                    onDeleteRows(selectedIds);
                    setRowSelection({});
                  }}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 px-2.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  }
                />
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-muted-foreground"
                onClick={() => setRowSelection({})}
              >
                <X className="size-3.5" /> Clear
              </Button>
            </>
          ) : (
            <span className="font-mono-data text-xs">
              {visibleRows.length} of {rows.length} rows
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectFields.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-2">
                  <ListFilter className="size-3.5" />
                  Filter
                  {activeFilterCount > 0 && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-brand-foreground">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-3">
                <div className="flex flex-col gap-3">
                  {selectFields.map((f) => (
                    <div key={f.id} className="flex flex-col gap-1.5">
                      <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                        {f.displayName}
                      </div>
                      <div className="flex flex-col gap-1">
                        {f.options!.map((o) => (
                          <label
                            key={o.value}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-muted"
                          >
                            <Checkbox
                              checked={(filters[f.id] ?? []).includes(o.value)}
                              onCheckedChange={() => toggleFilter(f.id, o.value)}
                            />
                            <span
                              className="text-[13px] font-semibold"
                              style={optColor(o.color)}
                            >
                              {o.value}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {activeFilterCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 justify-start px-1.5 text-muted-foreground"
                      onClick={() => setFilters({})}
                    >
                      <X className="mr-1 size-3.5" /> Clear filters
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <SlidersHorizontal className="size-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] w-56 overflow-y-auto">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((column) => {
                  const f = fields.find((x) => x.id === column.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(v) => column.toggleVisibility(!!v)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      <span className="truncate">{f?.displayName ?? column.id}</span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* table */}
      <div className="max-h-[calc(100vh-13rem)] overflow-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13.5px]">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header, i) => (
                  <th
                    key={header.id}
                    className={cn(
                      "h-11 border-b bg-card/95 px-3 text-left align-middle backdrop-blur first:pl-4",
                      i === 0 ? "w-12" : ""
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className="group transition-colors hover:bg-muted/50 data-[state=selected]:bg-brand/5"
              >
                {row.getVisibleCells().map((cell, i) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "h-11 border-b border-border/60 px-3 align-middle first:pl-4",
                      i === 0 ? "w-12" : "max-w-[360px]"
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRows.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">No rows match.</div>
        )}
      </div>
    </div>
  );
}
