"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import { isReadOnlyField, type FieldType } from "../types";

// The "where does it land" step, shared by the file/URL importer and the Google
// Sheets connector: a new table, or an existing one to upsert into (match by a key
// column, incoming columns mapped to fields — auto-matched by name, editable).

const SKIP = "__skip__";

export type Destination =
  | { mode: "new"; name: string }
  | { mode: "existing"; tableId: string; keyField: string; mapping: Record<string, string> };

interface DestTable {
  id: string;
  name: string;
  baseId: string;
  baseName: string;
}
interface DestField {
  id: string;
  key: string;
  name: string;
  type: string;
}

export function ImportDestination({
  columns,
  defaultName,
  busy,
  newLabel = "Create table",
  existingLabel = "Import",
  onApply,
}: {
  columns: string[];
  defaultName: string;
  busy: boolean;
  newLabel?: string;
  existingLabel?: string;
  onApply: (dest: Destination) => void;
}) {
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [name, setName] = React.useState(defaultName);
  const [tables, setTables] = React.useState<DestTable[]>([]);
  const [tableId, setTableId] = React.useState("");
  const [fields, setFields] = React.useState<DestField[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [keyField, setKeyField] = React.useState("");

  React.useEffect(() => {
    void (async () => {
      const res = await fetch("/api/import/tables");
      if (res.ok) setTables((await res.json()).tables as DestTable[]);
      else toast.error("Couldn't load your tables");
    })();
  }, []);

  const writableFields = React.useMemo(
    () => fields.filter((f) => !isReadOnlyField(f.type as FieldType)),
    [fields]
  );
  const mappedKeys = React.useMemo(
    () => new Set(Object.values(mapping).filter(Boolean)),
    [mapping]
  );

  const onSelectTable = async (id: string) => {
    setTableId(id);
    setFields([]);
    setKeyField("");
    const res = await fetch(`/api/tables/${id}/fields`);
    if (!res.ok) return toast.error("Couldn't load that table's columns");
    const flds = (await res.json()).fields as DestField[];
    setFields(flds);

    const byName = new Map(
      flds
        .filter((f) => !isReadOnlyField(f.type as FieldType))
        .map((f) => [f.name.trim().toLowerCase(), f.key])
    );
    const m: Record<string, string> = {};
    for (const c of columns) m[c] = byName.get(c.trim().toLowerCase()) ?? "";
    setMapping(m);

    const mapped = Object.values(m).filter(Boolean);
    const preferred = flds.find(
      (f) => mapped.includes(f.key) && /^(id|email|uuid|key)$/i.test(f.name.trim())
    );
    setKeyField(preferred?.key ?? mapped[0] ?? "");
  };

  const apply = () => {
    if (busy) return;
    if (mode === "new") return onApply({ mode: "new", name: name.trim() || defaultName });
    if (!tableId) return toast.error("Pick a table to import into");
    if (!keyField) return toast.error("Pick a column to match on");
    if (!mappedKeys.has(keyField)) return toast.error("Map a column to the match field");
    onApply({ mode: "existing", tableId, keyField, mapping });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {(["new", "existing"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors",
              mode === m ? "border-brand bg-brand/5" : "hover:bg-muted/50"
            )}
          >
            <span className="font-medium">{m === "new" ? "New table" : "Existing table"}</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {m === "new" ? "Create a fresh table" : "Add / update rows by a key"}
            </span>
          </button>
        ))}
      </div>

      {mode === "new" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dest-name" className="text-[12px] text-muted-foreground">
            Table name
          </Label>
          <Input id="dest-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">Table</Label>
            <Select value={tableId} onValueChange={onSelectTable}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a table" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.baseName} / {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {fields.length > 0 && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[12px] text-muted-foreground">Match rows on</Label>
                <Select value={keyField} onValueChange={setKeyField}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a key column" />
                  </SelectTrigger>
                  <SelectContent>
                    {writableFields
                      .filter((f) => mappedKeys.has(f.key))
                      .map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground">
                  Rows with a matching value update; the rest are added. Untouched rows stay.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-[12px] text-muted-foreground">Column mapping</Label>
                <div className="flex flex-col gap-1.5 rounded-lg border p-2">
                  {columns.map((col) => (
                    <div key={col} className="flex items-center gap-2">
                      <span className="w-1/2 truncate text-[13px]" title={col}>
                        {col}
                      </span>
                      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                      <Select
                        value={mapping[col] || SKIP}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [col]: v === SKIP ? "" : v }))}
                      >
                        <SelectTrigger className="h-8 w-1/2 text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP}>Skip</SelectItem>
                          {writableFields.map((f) => (
                            <SelectItem key={f.key} value={f.key}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <Button onClick={apply} disabled={busy} className="w-full gap-2">
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {busy ? "Working…" : mode === "new" ? newLabel : existingLabel}
      </Button>
    </div>
  );
}
