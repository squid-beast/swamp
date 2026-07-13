"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Dataset, FieldOverride, Row, RowPatch, ViewType, ViewConfig, resolveFields } from "@/core/types";
import { GridView } from "./views/GridView";
import { KanbanView } from "./views/KanbanView";
import { GalleryView } from "./views/GalleryView";
import { DashboardView } from "./views/DashboardView";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Search, Table2, Kanban, Images, Gauge, SlidersHorizontal, Eye, EyeOff, RefreshCw, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

const VIEW_ICON: Record<ViewType, React.ReactNode> = {
  grid: <Table2 className="size-3.5" />,
  kanban: <Kanban className="size-3.5" />,
  gallery: <Images className="size-3.5" />,
  dashboard: <Gauge className="size-3.5" />,
};

export function Workspace({ dataset, rows }: { dataset: Dataset; rows: Row[] }) {
  const [ds, setDs] = useState(dataset);
  const [data, setData] = useState<Row[]>(rows);
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const fields = useMemo(() => resolveFields(ds), [ds]);
  const isSheet = ds.source.kind === "sheet";

  useEffect(() => setData(rows), [rows]);
  // Keep the on-page title in sync when the dataset is renamed elsewhere (the
  // sidebar rename triggers a server refresh that streams a fresh prop in). Scoped
  // to `name` so it never clobbers optimistic field/view edits made here.
  useEffect(() => {
    setDs((prev) => (prev.name === dataset.name ? prev : { ...prev, name: dataset.name }));
  }, [dataset.name]);

  // Live updates: new responses land in dataset_rows and are appended in place.
  useEffect(() => {
    if (!isSupabaseConfigured || !isSheet) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`rows:${ds.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dataset_rows", filter: `dataset_id=eq.${ds.id}` },
        (payload) => {
          const rec = payload.new as { row_id: string; data: Record<string, unknown> };
          setData((d) =>
            d.some((r) => r.__id === rec.row_id) ? d : [...d, { __id: rec.row_id, ...rec.data }]
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ds.id, isSheet]);

  const syncNow = async () => {
    setSyncing(true);
    const res = await fetch("/api/sheets/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetId: ds.id }),
    });
    const json = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) return toast.error(json.error ?? "Sync failed");
    if (json.added > 0) {
      toast.success(`${json.added} new ${json.added === 1 ? "row" : "rows"} synced`);
      router.refresh();
    } else {
      toast.info("Already up to date");
    }
  };

  // Views are tracked by id (a dataset can hold several boards). Back-compat with
  // old ?view=<type> deep-links from the command palette.
  const viewFromQuery = searchParams.get("view");
  const matchView = (q: string | null) =>
    q ? (ds.views.find((v) => v.id === q) ?? ds.views.find((v) => v.type === q)) : undefined;
  const [activeId, setActiveId] = useState<string | undefined>(
    (matchView(viewFromQuery) ?? ds.views[0])?.id
  );
  const [search, setSearch] = useState("");

  // Deep-link support: command palette navigates with ?view=… Re-run only when the
  // query itself changes (not on board add/remove) so it can't yank the user off a
  // board they just switched to, and normalize ?view=<type> → the resolved <id>.
  useEffect(() => {
    const m = matchView(viewFromQuery);
    if (!m) return;
    setActiveId(m.id);
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") !== m.id) {
      url.searchParams.set("view", m.id);
      window.history.replaceState(null, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewFromQuery]);

  const view = ds.views.find((v) => v.id === activeId) ?? ds.views[0];

  const persistOverrides = async (overrides: Record<string, FieldOverride>) => {
    setDs((d) => ({ ...d, overrides }));
    await fetch(`/api/datasets/${ds.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides }),
    });
  };

  const toggleHidden = (fieldId: string) => {
    const cur = ds.overrides[fieldId] ?? {};
    const base = ds.fields.find((f) => f.id === fieldId)!;
    const hidden = !(cur.hidden ?? base.hidden);
    persistOverrides({ ...ds.overrides, [fieldId]: { ...cur, hidden } });
  };

  const renameField = (fieldId: string, displayName: string) => {
    const cur = ds.overrides[fieldId] ?? {};
    persistOverrides({ ...ds.overrides, [fieldId]: { ...cur, displayName } });
  };

  // ── row writes: optimistic update, then persist ──
  const patchRows = async (patches: RowPatch[]) => {
    const before = data;
    setData((d) =>
      d.map((r) => {
        const p = patches.find((x) => x.__id === r.__id);
        return p ? { ...r, ...p.values, __id: r.__id } : r;
      })
    );
    const res = await fetch(`/api/datasets/${ds.id}/rows`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patches }),
    });
    if (!res.ok) {
      setData(before);
      toast.error("Update failed");
      return;
    }
    toast.success(patches.length === 1 ? "Row updated" : `${patches.length} rows updated`);
  };

  const updateCell = (rowIds: string[], fieldId: string, value: unknown) =>
    patchRows(rowIds.map((__id) => ({ __id, values: { [fieldId]: value } })));

  const removeRows = async (rowIds: string[]) => {
    const before = data;
    setData((d) => d.filter((r) => !rowIds.includes(r.__id)));
    const res = await fetch(`/api/datasets/${ds.id}/rows`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowIds }),
    });
    if (!res.ok) {
      setData(before);
      toast.error("Delete failed");
      return;
    }
    toast.success(rowIds.length === 1 ? "Row deleted" : `${rowIds.length} rows deleted`);
  };

  const insertRow = async (values: Record<string, unknown>) => {
    const res = await fetch(`/api/datasets/${ds.id}/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(json.error ?? "Could not add row");
    // Dedupe on __id: on a live sheet the realtime INSERT broadcast may append
    // the same row first, so only add rows not already present.
    setData((d) => {
      const have = new Set(d.map((r) => r.__id));
      return [...d, ...((json.rows as Row[]) ?? []).filter((r) => !have.has(r.__id))];
    });
    toast.success("Row added");
  };

  const editRow = (rowId: string, values: Record<string, unknown>) =>
    patchRows([{ __id: rowId, values }]);

  const changeView = (id: string) => {
    if (!id) return;
    setActiveId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    window.history.replaceState(null, "", url.toString());
  };

  // ── Boards: add a kanban grouped by any low-cardinality column, or remove one. ──
  const boardFields = useMemo(
    () =>
      fields.filter((f) => {
        if (f.hidden || f.type === "json" || f.type === "image") return false;
        const distinct = new Set(data.map((r) => String(r[f.id] ?? ""))).size;
        // Categorical fields can drive lanes; still cap distinct so a mis-typed
        // high-cardinality column can't spawn hundreds of columns.
        if (f.type === "status" || f.type === "singleSelect" || f.type === "boolean")
          return distinct >= 1 && distinct <= 30;
        return distinct >= 2 && distinct <= 20 && distinct < data.length;
      }),
    [fields, data]
  );

  const persistViews = async (views: ViewConfig[]) => {
    setDs((d) => ({ ...d, views }));
    await fetch(`/api/datasets/${ds.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ views }),
    });
  };

  const addBoard = (fieldId: string) => {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const existing = ds.views.find((v) => v.type === "kanban" && v.groupBy === fieldId);
    if (existing) return changeView(existing.id);
    const titleField =
      fields.find((f) => /name|title|subject/i.test(f.sourceName) && f.type === "text") ??
      fields.find((f) => f.type === "text" && f.id !== fieldId);
    const newView: ViewConfig = {
      id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: "kanban",
      name: field.displayName,
      groupBy: field.id,
      titleField: titleField?.id,
    };
    const next = [...ds.views, newView];
    persistViews(next);
    changeView(newView.id);
  };

  const removeView = (viewId: string) => {
    const next = ds.views.filter((v) => v.id !== viewId);
    persistViews(next);
    if (activeId === viewId) changeView(next[0]?.id ?? "");
  };

  return (
    <div className="rise flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight md:text-3xl">
        {ds.name}
      </h1>

      <Tabs value={view?.id} onValueChange={changeView}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="max-w-full overflow-x-auto pb-0.5">
              <TabsList>
                {ds.views.map((v) => (
                  <TabsTrigger key={v.id} value={v.id} className="gap-1.5">
                    {VIEW_ICON[v.type]}
                    {v.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {boardFields.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 text-muted-foreground"
                  >
                    <Plus className="size-3.5" />
                    Board
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Group cards by…</DropdownMenuLabel>
                  {boardFields.map((f) => (
                    <DropdownMenuItem key={f.id} className="gap-2" onSelect={() => addBoard(f.id)}>
                      <Kanban className="size-3.5 text-muted-foreground" />
                      <span className="truncate">{f.displayName}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="flex items-center gap-2">
            {view?.type === "grid" && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rows…"
                  className="h-8 w-40 pl-8 sm:w-48"
                />
              </div>
            )}

            {view?.type === "kanban" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-muted-foreground"
                onClick={() => view && removeView(view.id)}
              >
                <X className="size-3.5" />
                Remove board
              </Button>
            )}

            {isSheet && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                onClick={syncNow}
                disabled={syncing}
              >
                <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
                Sync now
              </Button>
            )}

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-2">
                  <SlidersHorizontal className="size-3.5" />
                  Fields
                </Button>
              </SheetTrigger>
              <SheetContent className="flex w-80 flex-col gap-0 p-0">
                <SheetHeader className="border-b p-4">
                  <SheetTitle>Fields</SheetTitle>
                  <SheetDescription>
                    Rename or hide fields. Your changes survive re-imports.
                  </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1">
                  <div className="flex flex-col gap-0.5 p-2">
                    {fields.map((f) => (
                      <div
                        key={f.id}
                        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
                      >
                        <button
                          onClick={() => toggleHidden(f.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={f.hidden ? "Show field" : "Hide field"}
                        >
                          {f.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                        <input
                          defaultValue={f.displayName}
                          onBlur={(e) => e.target.value !== f.displayName && renameField(f.id, e.target.value)}
                          className={`min-w-0 flex-1 bg-transparent text-[13px] outline-none focus:text-brand ${
                            f.hidden ? "text-muted-foreground line-through" : ""
                          }`}
                        />
                        <span className="rounded border bg-muted px-1.5 py-0.5 font-mono-data text-[9.5px] uppercase text-muted-foreground">
                          {f.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </Tabs>

      <div className="min-w-0">
        {view?.type === "grid" && (
          <GridView
            fields={fields}
            rows={data}
            search={search}
            onToggleHidden={toggleHidden}
            onUpdateCell={updateCell}
            onDeleteRows={removeRows}
            onInsertRow={insertRow}
            onEditRow={editRow}
          />
        )}
        {view?.type === "kanban" && (
          <KanbanView fields={fields} rows={data} view={view} onUpdateCell={updateCell} />
        )}
        {view?.type === "gallery" && <GalleryView fields={fields} rows={data} view={view} />}
        {view?.type === "dashboard" && <DashboardView fields={fields} rows={data} />}
      </div>
    </div>
  );
}
