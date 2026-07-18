"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
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

// Import a file or a link → a real table.
//
// Two screens. First choose a source (file or URL) and preview it (columns + row
// count, nothing written). Then choose where it lands: a brand-new table, or an
// existing one — upserting by a key column you pick, with the incoming columns
// mapped to the table's fields (auto-matched by name, editable).

const ACCEPT = ".csv,.tsv,.xlsx,.xls,.json";
const SKIP = "__skip__";

interface Preview {
  columns: string[];
  sample: Record<string, unknown>[];
  rowCount: number;
}
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

export function ImportPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const baseId = params.get("baseId");

  const [file, setFile] = React.useState<File | null>(null);
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [destMode, setDestMode] = React.useState<"new" | "existing">("new");
  const [tables, setTables] = React.useState<DestTable[]>([]);
  const [tableId, setTableId] = React.useState("");
  const [fields, setFields] = React.useState<DestField[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [keyField, setKeyField] = React.useState("");

  const source: "file" | "url" | null = file ? "file" : url.trim() ? "url" : null;

  const pick = (f: File | null) => {
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  // ─── Step 1 → 2: preview ───
  const doPreview = async () => {
    if (!source || busy) return;
    setBusy(true);
    try {
      const res = file
        ? await fetch("/api/import/preview", { method: "POST", body: fileForm() })
        : await fetch("/api/import/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: url.trim() }),
          });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Couldn't read that source");
      setPreview(body as Preview);
      if (!tables.length) {
        const t = await fetch("/api/import/tables");
        if (t.ok) setTables((await t.json()).tables as DestTable[]);
        else toast.error("Couldn't load your tables");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fileForm = () => {
    const form = new FormData();
    form.append("file", file as File);
    return form;
  };

  const writableFields = React.useMemo(
    () => fields.filter((f) => !isReadOnlyField(f.type as FieldType)),
    [fields]
  );

  const onSelectTable = async (id: string) => {
    setTableId(id);
    setFields([]);
    setKeyField("");
    const res = await fetch(`/api/tables/${id}/fields`);
    if (!res.ok) return toast.error("Couldn't load that table's columns");
    const flds = (await res.json()).fields as DestField[];
    setFields(flds);

    // Auto-match incoming columns to fields by name.
    const byName = new Map(
      flds
        .filter((f) => !isReadOnlyField(f.type as FieldType))
        .map((f) => [f.name.trim().toLowerCase(), f.key])
    );
    const m: Record<string, string> = {};
    for (const c of preview?.columns ?? []) m[c] = byName.get(c.trim().toLowerCase()) ?? "";
    setMapping(m);

    const mapped = Object.values(m).filter(Boolean);
    const preferred = flds.find(
      (f) => mapped.includes(f.key) && /^(id|email|uuid|key)$/i.test(f.name.trim())
    );
    setKeyField(preferred?.key ?? mapped[0] ?? "");
  };

  const mappedKeys = React.useMemo(
    () => new Set(Object.values(mapping).filter(Boolean)),
    [mapping]
  );

  // ─── Step 2: apply ───
  const doImport = async () => {
    if (!source || busy) return;
    if (destMode === "existing") {
      if (!tableId) return toast.error("Pick a table to import into");
      if (!keyField) return toast.error("Pick a column to match on");
      if (!mappedKeys.has(keyField)) return toast.error("Map a column to the match field");
    }
    setBusy(true);

    try {
      let res: Response;
      if (file) {
        const form = fileForm();
        if (name.trim()) form.append("name", name.trim());
        if (baseId) form.append("baseId", baseId);
        if (destMode === "existing") {
          form.append("tableId", tableId);
          form.append("keyField", keyField);
          form.append("mapping", JSON.stringify(mapping));
        }
        res = await fetch("/api/import", { method: "POST", body: form });
      } else {
        res = await fetch("/api/import/url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: url.trim(),
            name: name.trim() || undefined,
            baseId: baseId || undefined,
            ...(destMode === "existing" ? { tableId, keyField, mapping } : {}),
          }),
        });
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Import failed");

      toast.success(
        body.mode === "upsert"
          ? `${body.updated} updated · ${body.added} added${body.skipped ? ` · ${body.skipped} skipped` : ""}`
          : `${(body.rowCount ?? 0).toLocaleString()} rows · ${body.fieldCount} fields`
      );
      router.refresh();
      router.push(`/app/t/${body.tableId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  // ─── Screen 1: source ───
  if (!preview) {
    return (
      <main className="mx-auto w-full max-w-lg p-6">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Import data</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          CSV, Excel or JSON — from a file or a public link. Choose a new table or add
          to an existing one on the next step.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "mt-6 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-brand bg-brand/5" : "border-border"
          )}
        >
          {file ? (
            <>
              <FileSpreadsheet className="size-6 text-brand" />
              <p className="text-[13px] font-medium">{file.name}</p>
              <p className="text-[12px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                Choose another
              </Button>
            </>
          ) : (
            <>
              <UploadCloud className="size-6 text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground">Drop a file here, or</p>
              <label>
                <input
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(e) => pick(e.target.files?.[0] ?? null)}
                />
                <span className="cursor-pointer text-[13px] font-medium text-brand underline underline-offset-2">
                  browse
                </span>
              </label>
            </>
          )}
        </div>

        {!file && (
          <>
            <div className="mt-6 flex items-center gap-3 text-[12px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or paste a link
              <span className="h-px flex-1 bg-border" />
            </div>
            <Input
              className="mt-4"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doPreview()}
              placeholder="https://…/data.csv or a public Google Sheet"
            />
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              A public CSV or JSON link, or a shared Google Sheet.
            </p>
          </>
        )}

        <Button onClick={doPreview} disabled={!source || busy} className="mt-6 w-full gap-2">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
          {busy ? "Reading…" : "Continue"}
        </Button>
      </main>
    );
  }

  // ─── Screen 2: destination ───
  return (
    <main className="mx-auto w-full max-w-lg p-6">
      <button
        onClick={() => setPreview(null)}
        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back
      </button>

      <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight">Where does it go?</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {preview.columns.length} columns · {preview.rowCount.toLocaleString()} rows from{" "}
        {file ? file.name : "the link"}.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {(["new", "existing"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setDestMode(m)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors",
              destMode === m ? "border-brand bg-brand/5" : "hover:bg-muted/50"
            )}
          >
            <span className="font-medium">{m === "new" ? "New table" : "Existing table"}</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {m === "new" ? "Create a fresh table" : "Add / update rows by a key"}
            </span>
          </button>
        ))}
      </div>

      {destMode === "new" ? (
        <div className="mt-5 flex flex-col gap-1.5">
          <Label htmlFor="table-name" className="text-[12px] text-muted-foreground">
            Table name
          </Label>
          <Input
            id="table-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Imported"
          />
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
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
                  {preview.columns.map((col) => (
                    <div key={col} className="flex items-center gap-2">
                      <span className="w-1/2 truncate text-[13px]" title={col}>
                        {col}
                      </span>
                      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                      <Select
                        value={mapping[col] || SKIP}
                        onValueChange={(v) =>
                          setMapping((m) => ({ ...m, [col]: v === SKIP ? "" : v }))
                        }
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
        </div>
      )}

      <Button onClick={doImport} disabled={busy} className="mt-6 w-full gap-2">
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {busy ? "Importing…" : destMode === "new" ? "Create table" : "Import"}
      </Button>
    </main>
  );
}
