"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dataset,
  DatasetSummary,
  FieldMeta,
  Row,
  RowPatch,
  ViewConfig,
  resolveFields,
} from "@/core/types";
import { KanbanView } from "@/components/views/KanbanView";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Columns that make sensible lanes: categorical fields, or any low-cardinality
// column whose values repeat across rows (mirrors Workspace's board picker).
function groupableFields(fields: FieldMeta[], rows: Row[]): FieldMeta[] {
  return fields.filter((f) => {
    if (f.hidden || f.type === "json" || f.type === "image") return false;
    const distinct = new Set(rows.map((r) => String(r[f.id] ?? ""))).size;
    if (f.type === "status" || f.type === "singleSelect" || f.type === "boolean")
      return distinct >= 1 && distinct <= 30;
    return distinct >= 2 && distinct <= 20 && distinct < rows.length;
  });
}

export function BoardPage({ datasets }: { datasets: DatasetSummary[] }) {
  const [datasetId, setDatasetId] = React.useState<string>(datasets[0]?.id ?? "");
  const [ds, setDs] = React.useState<Dataset | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [groupBy, setGroupBy] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);

  const fields = React.useMemo(() => (ds ? resolveFields(ds) : []), [ds]);
  const groupOptions = React.useMemo(() => groupableFields(fields, rows), [fields, rows]);

  // Guard against out-of-order responses: only the most recently requested
  // dataset may write state, so a slow earlier fetch can't clobber a newer one.
  const latestId = React.useRef(datasetId);

  const load = React.useCallback(async (id: string) => {
    latestId.current = id;
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/datasets/${id}`);
    const json = await res.json().catch(() => null);
    if (id !== latestId.current) return; // a newer dataset was selected — drop this
    setLoading(false);
    if (!res.ok || !json?.dataset) {
      toast.error(json?.error ?? "Could not load dataset");
      return;
    }
    setDs(json.dataset as Dataset);
    setRows((json.rows as Row[]) ?? []);
  }, []);

  React.useEffect(() => {
    if (datasetId) load(datasetId);
  }, [datasetId, load]);

  // Effective group column: the user's choice if still valid for this dataset,
  // else a sensible default — computed during render so the board never renders
  // with the previous dataset's group field for a frame when switching.
  const effectiveGroupBy = React.useMemo(() => {
    if (groupOptions.some((f) => f.id === groupBy)) return groupBy;
    const pref =
      groupOptions.find((f) => f.type === "status" || f.type === "singleSelect") ??
      groupOptions[0];
    return pref?.id ?? "";
  }, [groupOptions, groupBy]);

  const titleField = React.useMemo(
    () =>
      fields.find((f) => /name|title|subject/i.test(f.sourceName) && f.type === "text") ??
      fields.find((f) => f.type === "text" && f.id !== effectiveGroupBy),
    [fields, effectiveGroupBy]
  );

  const view: ViewConfig | null = effectiveGroupBy
    ? {
        id: "board",
        type: "kanban",
        name: "Board",
        groupBy: effectiveGroupBy,
        titleField: titleField?.id,
      }
    : null;

  // Drag-to-move / edits: optimistic, then persist to the same rows endpoint.
  const updateCell = async (rowIds: string[], fieldId: string, value: unknown) => {
    const before = rows;
    setRows((d) => d.map((r) => (rowIds.includes(r.__id) ? { ...r, [fieldId]: value } : r)));
    const patches: RowPatch[] = rowIds.map((__id) => ({ __id, values: { [fieldId]: value } }));
    const res = await fetch(`/api/datasets/${datasetId}/rows`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patches }),
    });
    if (!res.ok) {
      setRows(before);
      toast.error("Update failed");
    }
  };

  return (
    <div className="rise flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">
          Kanban Board
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Group any dataset into columns and drag cards between them to change their value.
        </p>
      </div>

      {datasets.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No datasets yet. Import one first, then build a board here.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label id="board-dataset" className="text-[12px] text-muted-foreground">
                Dataset
              </Label>
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger aria-labelledby="board-dataset" className="w-56">
                  <SelectValue placeholder="Choose a dataset" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {groupOptions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label id="board-groupby" className="text-[12px] text-muted-foreground">
                  Group by
                </Label>
                <Select value={effectiveGroupBy} onValueChange={setGroupBy}>
                  <SelectTrigger aria-labelledby="board-groupby" className="w-56">
                    <SelectValue placeholder="Choose a column" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupOptions.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : !ds ? null : view ? (
            <KanbanView fields={fields} rows={rows} view={view} onUpdateCell={updateCell} />
          ) : (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              “{ds.name}” has no column suitable for a board. Pick a dataset with a status or
              category column whose values repeat across rows.
            </div>
          )}
        </>
      )}
    </div>
  );
}
