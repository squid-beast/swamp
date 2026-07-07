"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Dataset, FieldOverride, Row, RowPatch, ViewType, resolveFields } from "@/core/types";
import { GridView } from "./views/GridView";
import { KanbanView } from "./views/KanbanView";
import { GalleryView } from "./views/GalleryView";
import { DashboardView } from "./views/DashboardView";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Search, Table2, Kanban, Images, Gauge, SlidersHorizontal, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  const viewFromQuery = searchParams.get("view") as ViewType | null;
  const initialType =
    (viewFromQuery && ds.views.find((v) => v.type === viewFromQuery)?.type) ?? ds.views[0]?.type;
  const [activeType, setActiveType] = useState<ViewType>(initialType);
  const [search, setSearch] = useState("");

  // Deep-link support: command palette navigates with ?view=…
  useEffect(() => {
    if (viewFromQuery && ds.views.some((v) => v.type === viewFromQuery)) {
      setActiveType(viewFromQuery);
    }
  }, [viewFromQuery, ds.views]);

  const view = ds.views.find((v) => v.type === activeType) ?? ds.views[0];

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

  const changeView = (t: string) => {
    setActiveType(t as ViewType);
    const url = new URL(window.location.href);
    url.searchParams.set("view", t);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <div className="rise flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight md:text-3xl">
        {ds.name}
      </h1>

      <Tabs value={activeType} onValueChange={changeView}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="max-w-full overflow-x-auto pb-0.5">
            <TabsList>
              {ds.views.map((v) => (
                <TabsTrigger key={v.id} value={v.type} className="gap-1.5">
                  {VIEW_ICON[v.type]}
                  {v.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex items-center gap-2">
            {activeType === "grid" && (
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
