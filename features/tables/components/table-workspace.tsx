"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Redo2, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useRecords } from "../use-records";
import { useGrid } from "../use-grid";
import { useRealtime } from "../use-realtime";
import type {
  Field,
  FilterNode,
  QuerySpec,
  SortSpec,
  Table,
  View,
  ViewField,
} from "../types";
import { canEditViewConfig } from "../types";
import { Grid } from "./grid";
import { Gallery } from "./gallery";
import { Kanban } from "./kanban";
import { Calendar } from "./calendar";
import { FormBuilder } from "./form-builder";
import { Toolbar, type RowHeight } from "./toolbar";
import { ViewMenu } from "./view-menu";
import { FieldDialog } from "./field-dialog";
import { ExpandedRecord } from "./expanded-record";

// The table workspace.
//
// It does not hold the records — `spec` is the state, the spec goes to Postgres,
// Postgres returns a page. And it does not mutate them directly: every write is a
// Command, so every write can be undone.

export interface ViewConfigData {
  viewFields: ViewField[];
  filter: FilterNode | null;
  sorts: SortSpec[];
}

export function TableWorkspace({
  table,
  fields: initialFields,
  views,
  view: initialView,
  config: initialConfig,
  tables,
  userId,
  role,
}: {
  table: Table;
  fields: Field[];
  views: View[];
  view: View;
  config: ViewConfigData;
  /** Every table in the base — a link field needs somewhere to point. */
  tables: Table[];
  userId: string;
  role: "viewer" | "commenter" | "editor" | "creator" | "owner" | null;
}) {
  const router = useRouter();

  const [fields, setFields] = React.useState(initialFields);
  const [view, setView] = React.useState(initialView);
  const [config, setConfig] = React.useState(initialConfig);

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [fieldDialog, setFieldDialog] = React.useState<{ open: boolean; field?: Field }>({
    open: false,
  });

  const canEdit = canEditViewConfig(role, view, userId);

  const hidden = React.useMemo(
    () => new Set(config.viewFields.filter((vf) => !vf.show).map((vf) => vf.fieldId)),
    [config.viewFields]
  );

  const widths = React.useMemo(
    () =>
      new Map(
        config.viewFields
          .filter((vf) => vf.width != null)
          .map((vf) => [vf.fieldId, vf.width as number])
      ),
    [config.viewFields]
  );

  const rowHeight: RowHeight = (view.config.rowHeight as RowHeight) ?? "short";

  const orderedFields = React.useMemo(() => {
    const order = new Map(config.viewFields.map((vf) => [vf.fieldId, vf.sortOrder]));
    return [...fields].sort(
      (a, b) => (order.get(a.id) ?? a.sortOrder) - (order.get(b.id) ?? b.sortOrder)
    );
  }, [fields, config.viewFields]);

  const visibleFields = React.useMemo(
    () => orderedFields.filter((f) => !hidden.has(f.id)),
    [orderedFields, hidden]
  );

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const spec: QuerySpec = React.useMemo(
    () => ({
      ...(config.filter ? { filter: config.filter } : {}),
      ...(config.sorts.length ? { sort: config.sorts } : {}),
      ...(debounced ? { search: debounced } : {}),
    }),
    [config.filter, config.sorts, debounced]
  );

  const {
    records,
    total,
    cursor,
    loading,
    loadingMore,
    error,
    loadMore,
    applyLocal,
    reload,
  } = useRecords(table.id, spec);

  const grid = useGrid({
    fields: visibleFields,
    records,
    tableId: table.id,
    applyLocal,
    onRecordsChanged: () => router.refresh(),
  });

  // Someone else's edit lands without a refresh.
  //
  // The subscriber ignores OUR OWN echoes — see use-realtime.ts. Re-applying your
  // own write fights the optimistic update and yanks the value out from under the
  // cursor if you're still typing. That bug only appears when the round trip is
  // slower than the next keystroke, which is why it's so unpleasant to find.
  useRealtime({
    tableId: table.id,
    onUpsert: (record) =>
      applyLocal((rs) => rs.map((r) => (r.id === record.id ? record : r))),
    onDelete: (id) => applyLocal((rs) => rs.filter((r) => r.id !== id)),
    onReload: reload,
  });

  // ── View config: every change writes straight through ──

  const patchConfig = React.useCallback(
    async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/views/${view.id}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Could not save the view");
        return;
      }

      setConfig((await res.json()) as ViewConfigData);
    },
    [view.id]
  );

  const setFilter = (filter: FilterNode | null) => {
    setConfig((c) => ({ ...c, filter }));
    void patchConfig({ filter });
  };

  const setSorts = (sorts: SortSpec[]) => {
    setConfig((c) => ({ ...c, sorts }));
    void patchConfig({ sorts });
  };

  const setHidden = (next: Set<string>) => {
    void patchConfig({
      viewFields: fields.map((f, i) => ({
        fieldId: f.id,
        show: !next.has(f.id),
        sortOrder: config.viewFields.find((vf) => vf.fieldId === f.id)?.sortOrder ?? i,
      })),
    });
  };

  // Column resize fires on every mousemove. Update local state at once so the drag
  // is smooth, and debounce the write — a PATCH per pixel would flood the server
  // and land out of order.
  const resizeTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const resizeField = (fieldId: string, width: number) => {
    setConfig((c) => ({
      ...c,
      viewFields: c.viewFields.some((vf) => vf.fieldId === fieldId)
        ? c.viewFields.map((vf) => (vf.fieldId === fieldId ? { ...vf, width } : vf))
        : [
            ...c.viewFields,
            {
              viewId: view.id,
              fieldId,
              show: true,
              sortOrder: 0,
              width,
              aggregation: null,
              groupBy: false,
              groupByOrder: null,
              groupByDir: null,
              formConfig: {},
            },
          ],
    }));

    clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => {
      void patchConfig({ viewFields: [{ fieldId, width }] });
    }, 400);
  };

  const setRowHeight = async (h: RowHeight) => {
    setView((v) => ({ ...v, config: { ...v.config, rowHeight: h } }));
    await fetch(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ...view.config, rowHeight: h } }),
    });
  };

  const reloadFields = React.useCallback(async () => {
    const res = await fetch(`/api/tables/${table.id}/fields`);
    if (res.ok) setFields((await res.json()).fields as Field[]);
    router.refresh();
  }, [table.id, router]);

  const expandedIndex = expandedId ? records.findIndex((r) => r.id === expandedId) : -1;

  // ── Kanban / gallery config ──

  const stackField = view.config.stackFieldId
    ? fields.find((f) => f.id === view.config.stackFieldId)
    : fields.find((f) => f.type === "singleSelect" || f.type === "status");

  const coverField = view.config.coverFieldId
    ? fields.find((f) => f.id === view.config.coverFieldId)
    : fields.find((f) => f.type === "image" || f.type === "attachment");

  // A calendar puts records on days via a date field. Fall back to the first date
  // field, so a calendar created without config still opens.
  const dateField = view.config.ranges?.[0]?.fromFieldId
    ? fields.find((f) => f.id === view.config.ranges![0].fromFieldId)
    : fields.find((f) => f.type === "date" || f.type === "datetime");

  const collapsedStacks = new Set(
    (view.config.stacks ?? []).filter((s) => s.collapsed).map((s) => s.id)
  );

  const setCollapsedStacks = async (next: Set<string>) => {
    const stacks = [...next].map((id, i) => ({ id, title: id, order: i, collapsed: true }));
    setView((v) => ({ ...v, config: { ...v.config, stacks } }));
    await fetch(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ...view.config, stacks } }),
    });
  };

  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col">
      <Toolbar
        fields={orderedFields}
        views={views}
        view={view}
        viewMenu={
          <ViewMenu
            tableId={table.id}
            views={views}
            view={view}
            fields={fields}
            canEdit={canEdit}
            onChanged={() => router.refresh()}
          />
        }
        filter={config.filter}
        onFilterChange={setFilter}
        sorts={config.sorts}
        onSortsChange={setSorts}
        hidden={hidden}
        onHiddenChange={setHidden}
        rowHeight={rowHeight}
        onRowHeightChange={setRowHeight}
        search={search}
        onSearchChange={setSearch}
        canEditConfig={canEdit}
        onExport={() => {
          window.location.href = `/api/tables/${table.id}/export?viewId=${view.id}`;
        }}
        onAddField={() => setFieldDialog({ open: true })}
        undo={
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0"
              disabled={!grid.canUndo}
              onClick={grid.undo}
              title="Undo (⌘Z)"
              aria-label="Undo"
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0"
              disabled={!grid.canRedo}
              onClick={grid.redo}
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
        }
      />

      {selected.size > 0 && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
          <span className="text-[13px] tabular-nums">{selected.size} selected</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-destructive"
            onClick={() => {
              grid.deleteRecords([...selected]);
              setSelected(new Set());
            }}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setSelected(new Set())}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        </div>
      )}

      {error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-destructive">
          {error}
        </div>
      ) : view.type === "kanban" && stackField ? (
        <Kanban
          fields={orderedFields}
          hidden={hidden}
          records={records}
          stackField={stackField}
          collapsed={collapsedStacks}
          onCollapsedChange={setCollapsedStacks}
          onUpdateCell={(id, key, value) => {
            const row = records.findIndex((r) => r.id === id);
            const col = visibleFields.findIndex((f) => f.key === key);
            if (row >= 0 && col >= 0) grid.setCell(row, col, value);
          }}
          onExpand={setExpandedId}
          onAddRecord={grid.addRecord}
        />
      ) : view.type === "gallery" ? (
        <Gallery
          fields={orderedFields}
          hidden={hidden}
          records={records}
          coverField={coverField}
          onExpand={setExpandedId}
        />
      ) : view.type === "calendar" && dateField ? (
        <Calendar
          fields={orderedFields}
          records={records}
          fromField={dateField}
          onExpand={setExpandedId}
          onSetDate={(id, date) => {
            const row = records.findIndex((r) => r.id === id);
            const col = visibleFields.findIndex((f) => f.id === dateField.id);
            // Route through the grid's setCell so a re-date is an undoable command
            // like any other edit — dragging an event is not a special case.
            if (row >= 0 && col >= 0) grid.setCell(row, col, date);
          }}
        />
      ) : view.type === "form" ? (
        <FormBuilder
          fields={orderedFields}
          view={view}
          viewFields={config.viewFields}
          onSave={async (patch) => {
            if (patch.view) {
              await fetch(`/api/views/${view.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch.view),
              });
              setView((v) => ({ ...v, ...(patch.view as Partial<View>) }));
            }
            if (patch.viewFields) await patchConfig({ viewFields: patch.viewFields });
          }}
        />
      ) : (
        <Grid
          fields={visibleFields}
          records={records}
          total={total}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={!!cursor}
          rowHeight={rowHeight}
          widths={widths}
          onLoadMore={loadMore}
          onAddRecord={() => grid.addRecord({})}
          onExpand={setExpandedId}
          onEditField={(f) => setFieldDialog({ open: true, field: f })}
          onResizeField={resizeField}
          tableId={table.id}
          // A link writes to the `links` table, not to `data`, so the row's
          // rollups and lookups change too. Only the server knows the new values —
          // refetch rather than guess.
          onLinksChanged={reload}
          selected={selected}
          onSelectedChange={setSelected}
          active={grid.active}
          setActive={grid.setActive}
          range={grid.range}
          setRange={grid.setRange}
          editing={grid.editing}
          setEditing={grid.setEditing}
          onKeyDown={grid.onKeyDown}
          onPaste={grid.paste}
          onSetCell={grid.setCell}
          onCommitFill={grid.commitFill}
          onDeleteRecords={grid.deleteRecords}
          onMoveRecord={grid.moveRecord}
        />
      )}

      <FieldDialog
        open={fieldDialog.open}
        onOpenChange={(open) => setFieldDialog({ open })}
        tableId={table.id}
        fields={orderedFields}
        tables={tables}
        field={fieldDialog.field}
        onSaved={() => {
          void reloadFields();
          reload();
        }}
      />

      {expandedIndex >= 0 && (
        <ExpandedRecord
          open
          onOpenChange={(o) => !o && setExpandedId(null)}
          fields={orderedFields}
          hidden={hidden}
          records={records}
          index={expandedIndex}
          onIndexChange={(i) => setExpandedId(records[i]?.id ?? null)}
          onUpdateCell={(id, key, value) => {
            const row = records.findIndex((r) => r.id === id);
            const col = visibleFields.findIndex((f) => f.key === key);
            if (row >= 0 && col >= 0) grid.setCell(row, col, value);
          }}
          onDelete={(id) => grid.deleteRecords([id])}
          tableId={table.id}
          onLinksChanged={reload}
          currentUserId={userId}
        />
      )}
    </main>
  );
}
