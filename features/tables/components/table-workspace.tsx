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
  ViewConfigData,
} from "../types";
import { canEditViewConfig, COMPUTED_FIELD_TYPES } from "../types";
import { Grid, groupKeyOf } from "./grid";
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

export function TableWorkspace({
  table,
  fields: initialFields,
  views,
  view: initialView,
  config: initialConfig,
  tables,
  userId,
  role,
  openRecordId,
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
  /** From ?record=… — open this record expanded on load. */
  openRecordId?: string | null;
}) {
  const router = useRouter();

  const [fields, setFields] = React.useState(initialFields);
  const [view, setView] = React.useState(initialView);
  const [config, setConfig] = React.useState(initialConfig);

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Seeded from ?record=…, so a copied link opens the record it names.
  //
  // The "Copy link" button in the expanded record has always produced
  // `?record=<id>`, and nothing has ever read it — the button said "Link copied"
  // and the link went to a plain grid. Note the record may not be on the first
  // page, or may not match the view's filter at all; that is handled where the
  // record is looked up, not here.
  const [expandedId, setExpandedId] = React.useState<string | null>(openRecordId ?? null);
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

  /** The field this view groups by, if any. One level for now — the model carries
   *  group_by_order for three, like NocoDB, and the day a second level is wanted the
   *  sort below just gets another entry. */
  const groupBy = React.useMemo(() => {
    const vf = config.viewFields
      .filter((v) => v.groupBy)
      .sort((a, b) => (a.groupByOrder ?? 0) - (b.groupByOrder ?? 0))[0];
    if (!vf) return null;

    const field = fields.find((f) => f.id === vf.fieldId);
    return field ? { field, dir: vf.groupByDir ?? ("asc" as const) } : null;
  }, [config.viewFields, fields]);

  const spec: QuerySpec = React.useMemo(
    () => ({
      ...(config.filter ? { filter: config.filter } : {}),
      // Grouping IS a sort, and it goes first.
      //
      // That is the whole trick: rows then arrive grouped, contiguously, and the
      // keyset cursor works over it unchanged because the compiler builds the cursor
      // generically from whatever is in `sort`. The grid puts a header wherever the
      // value changes. No engine change, no pagination-within-groups problem.
      ...(groupBy || config.sorts.length
        ? {
            sort: [
              ...(groupBy ? [{ field: groupBy.field.key, dir: groupBy.dir }] : []),
              ...config.sorts,
            ],
          }
        : {}),
      ...(debounced ? { search: debounced } : {}),
    }),
    [config.filter, config.sorts, debounced, groupBy]
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

  // The group headers.
  //
  // Fetched separately from the rows, and refetched only when the FILTER, the SEARCH
  // or the grouped field changes — never on scroll. The counts describe the whole
  // filtered set, so they must not be recomputed per page, and counting the loaded
  // window instead would report "3" for a group of 3,000.
  const [groupCounts, setGroupCounts] = React.useState<Map<string, number>>(new Map());
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const groupKey = groupBy?.field.key;
  const groupDir = groupBy?.dir;
  const countsKey = JSON.stringify({
    f: config.filter,
    s: debounced,
    k: groupKey,
    d: groupDir,
  });

  React.useEffect(() => {
    if (!groupKey) {
      setGroupCounts(new Map());
      return;
    }

    let alive = true;
    void fetch(`/api/tables/${table.id}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: {
          ...(config.filter ? { filter: config.filter } : {}),
          ...(debounced ? { search: debounced } : {}),
        },
        field: groupKey,
        dir: groupDir ?? "asc",
      }),
    })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((b: { groups?: { value: unknown; count: number }[] }) => {
        if (!alive) return;
        setGroupCounts(
          new Map((b.groups ?? []).map((g) => [groupKeyOf(g.value), Number(g.count)]))
        );
      })
      .catch(() => alive && setGroupCounts(new Map()));

    return () => {
      alive = false;
    };
    // countsKey collapses the four things that actually change the answer; the
    // filter object is rebuilt on every render and would otherwise refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey, table.id]);

  // A cell edit can change a rollup/formula/lookup/count on a DIFFERENT row, which
  // only the server can compute. When the table has such fields, refetch after a
  // write — debounced, so a burst of typing is one request, not one per keystroke.
  // Plain tables never refetch. (router.refresh() was wired here but useGrid never
  // called it, so cross-row values silently went stale until a manual reload.)
  const hasComputed = React.useMemo(
    () => fields.some((f) => (COMPUTED_FIELD_TYPES as readonly string[]).includes(f.type)),
    [fields]
  );
  const reloadTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRecordsChanged = React.useCallback(() => {
    if (!hasComputed) return;
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(reload, 400);
  }, [hasComputed, reload]);

  const grid = useGrid({
    fields: visibleFields,
    records,
    tableId: table.id,
    applyLocal,
    onRecordsChanged,
  });

  // Someone else's edit lands without a refresh.
  //
  // The subscriber ignores OUR OWN echoes — see use-realtime.ts. Re-applying your
  // own write fights the optimistic update and yanks the value out from under the
  // cursor if you're still typing. That bug only appears when the round trip is
  // slower than the next keystroke, which is why it's so unpleasant to find.
  const { presence } = useRealtime({
    tableId: table.id,
    // MERGE `data`, don't replace it.
    //
    // The realtime payload is the raw `records` row, and `records.data` holds only
    // STORED scalars. Every computed key — formula, rollup, lookup, count, and the
    // createdBy/createdTime/modifiedBy/modifiedTime types — is merged in by
    // swamp_query_records at query time and is simply not in that column. Replacing
    // the record wholesale therefore blanked every one of them the moment anybody
    // touched the row, until the next refetch. A formula column would empty itself
    // while you watched a colleague type.
    //
    // ponytail: merged, not refetched. A merge keeps the last known computed value,
    // which is exactly right for createdBy/createdTime (they never change) and
    // briefly stale for formulas and modifiedTime after someone else's edit. The
    // correct fix is to refetch the row when the table has computed fields, but
    // that is a request per co-editor keystroke; if the staleness ever bites,
    // that's the upgrade path.
    onUpsert: (record) =>
      applyLocal((rs) =>
        rs.map((r) =>
          r.id === record.id ? { ...record, data: { ...r.data, ...record.data } } : r
        )
      ),
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

  // The view ROW (name, lockType, config blob) — distinct from patchConfig above,
  // which writes the filter/sort/field tables behind /config. Four callers used to
  // inline this exact three-line fetch.
  const patchView = React.useCallback(
    (body: Record<string, unknown>) =>
      fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
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

  /** Field order, per VIEW — which is the only order the grid actually reads.
   *
   *  There is a PATCH /api/tables/[id]/fields route that calls reorderFields(), and
   *  it is the wrong tool: it writes `fields.sort_order`, per TABLE, while
   *  orderedFields above sorts by `config.viewFields` and falls back to
   *  fields.sortOrder only for a field with no view_fields row. Wiring a UI to that
   *  route would appear to work on a fresh table and silently do NOTHING the moment
   *  anyone hid a field or resized a column, because that writes a view_fields row
   *  and the fallback stops applying. (NocoDB is per-view too — see
   *  nc-gui/composables/useViewColumns.ts saveOrUpdate.) The route and reorderFields
   *  are deleted in this commit rather than left as a trap.
   *
   *  `show` goes with every row on purpose. PostgREST's bulk upsert unions the keys
   *  across the array, so a payload where only SOME rows carry `show` sends NULL for
   *  the rest — which the NOT NULL would reject, taking the whole batch with it.
   *  Homogeneous rows, like setHidden above. */
  /** Group by a field, or stop.
   *
   *  Writes every field's row, homogeneously — saveViewFields batches by key
   *  signature now, but sending the whole set is also what makes "only one field is
   *  grouped" true rather than hoped for: the previous grouped field is explicitly
   *  turned off rather than left behind. */
  const setGroupBy = (next: { fieldId: string; dir: "asc" | "desc" } | null) => {
    // Collapse state is keyed by GROUP VALUE, and the values change completely when
    // you group by a different field. Keeping it would silently collapse unrelated
    // groups that happened to share a key.
    setCollapsed(new Set());

    void patchConfig({
      viewFields: fields.map((f) => ({
        fieldId: f.id,
        groupBy: next?.fieldId === f.id,
        groupByOrder: next?.fieldId === f.id ? 0 : null,
        groupByDir: next?.fieldId === f.id ? next.dir : null,
      })),
    });
  };

  const setFieldOrder = (orderedIds: string[]) => {
    void patchConfig({
      viewFields: orderedIds.map((id, i) => ({
        fieldId: id,
        show: !hidden.has(id),
        sortOrder: i,
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
    const config = { ...view.config, rowHeight: h };
    setView((v) => ({ ...v, config }));
    await patchView({ config });
  };

  // Colour rows by a select/status field's option colours. Lives on the view
  // config, saved the same way row height is.
  const setColorField = async (fieldId: string | null) => {
    const config = { ...view.config, colorFieldId: fieldId ?? undefined };
    setView((v) => ({ ...v, config }));
    await patchView({ config });
  };

  const colorField = view.config.colorFieldId
    ? fields.find((f) => f.id === view.config.colorFieldId)
    : null;

  // Returns the palette name of the row's option, which the grid maps to a stripe.
  const rowColor = React.useCallback(
    (record: (typeof records)[number]) => {
      if (!colorField) return null;
      const value = record.data[colorField.key];
      return colorField.options.options?.find((o) => o.value === value)?.color ?? null;
    },
    [colorField]
  );

  const reloadFields = React.useCallback(async () => {
    const res = await fetch(`/api/tables/${table.id}/fields`);
    if (res.ok) setFields((await res.json()).fields as Field[]);
    router.refresh();
  }, [table.id, router]);

  const expandedIndex = expandedId ? records.findIndex((r) => r.id === expandedId) : -1;

  // A ?record= link that names a record this view isn't showing must SAY so.
  //
  // The grid holds a page, not the table, and the view has a filter — so a link
  // can legitimately point at a record that is real and simply not here (further
  // down the cursor, or filtered out). Without this, expandedIndex stays -1 and the
  // dialog renders nothing: the link would once again do nothing at all and blame
  // nobody, which is the bug this whole feature is fixing.
  //
  // ponytail: it says "not in this view" rather than going and fetching the record.
  // Fetching one record by id needs a route that doesn't exist on the session API,
  // and the honest message is most of the value. If people start hitting it, the
  // upgrade path is that route.
  const announcedMissing = React.useRef(false);
  React.useEffect(() => {
    if (!openRecordId || loading || announcedMissing.current) return;
    if (records.some((r) => r.id === openRecordId)) return;

    announcedMissing.current = true;
    toast.info("That record isn't in this view — it may be filtered out.");
    setExpandedId(null);
  }, [openRecordId, loading, records]);

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
    const config = { ...view.config, stacks };
    setView((v) => ({ ...v, config }));
    await patchView({ config });
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
            onRestored={reload}
          />
        }
        filter={config.filter}
        onFilterChange={setFilter}
        sorts={config.sorts}
        onSortsChange={setSorts}
        hidden={hidden}
        onHiddenChange={setHidden}
        onReorder={setFieldOrder}
        groupBy={groupBy ? { fieldId: groupBy.field.id, dir: groupBy.dir } : null}
        onGroupByChange={setGroupBy}
        rowHeight={rowHeight}
        onRowHeightChange={setRowHeight}
        colorFieldId={view.config.colorFieldId ?? null}
        onColorFieldChange={setColorField}
        presence={presence}
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
              await patchView(patch.view as Record<string, unknown>);
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
          groups={
            groupBy
              ? {
                  fieldKey: groupBy.field.key,
                  counts: groupCounts,
                  collapsed,
                  onToggle: (key) =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    }),
                }
              : undefined
          }
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
          rowColor={rowColor}
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
          // A duplicate is just an insert of the same values. Nothing needs
          // stripping here: the write path already refuses every read-only type
          // (sanitizeValues -> isReadOnlyField), so the id, the timestamps, the
          // createdBy/modifiedBy stamps, formulas, rollups and links all drop out on
          // the server. Doing it here as well would be a second list to keep in step
          // with the first, and the wrong one would be the one that let something
          // through. Links are edges rather than values, so a copy does not carry
          // them — NocoDB's duplicate does; ours is the smaller promise.
          onDuplicate={(r) => grid.addRecord(r.data)}
          tableId={table.id}
          onLinksChanged={reload}
          currentUserId={userId}
        />
      )}
    </main>
  );
}
