"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import { ImportDestination, type Destination } from "./import-destination";

// Import a file or a link → a real table.
//
// Two screens: choose a source (file or URL) and preview it (columns + row count,
// nothing written), then choose where it lands (ImportDestination: new table, or an
// existing one to upsert into).

const ACCEPT = ".csv,.tsv,.xlsx,.xls,.json";

interface Preview {
  columns: string[];
  sample: Record<string, unknown>[];
  rowCount: number;
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

  const source: "file" | "url" | null = file ? "file" : url.trim() ? "url" : null;

  const pick = (f: File | null) => {
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const fileForm = () => {
    const form = new FormData();
    form.append("file", file as File);
    return form;
  };

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
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (dest: Destination) => {
    if (!source || busy) return;
    setBusy(true);
    try {
      let res: Response;
      if (file) {
        const form = fileForm();
        if (baseId) form.append("baseId", baseId);
        if (dest.mode === "new") {
          if (dest.name.trim()) form.append("name", dest.name.trim());
        } else {
          form.append("tableId", dest.tableId);
          form.append("keyField", dest.keyField);
          form.append("mapping", JSON.stringify(dest.mapping));
        }
        res = await fetch("/api/import", { method: "POST", body: form });
      } else {
        res = await fetch("/api/import/url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: url.trim(),
            baseId: baseId || undefined,
            ...(dest.mode === "new"
              ? { name: dest.name.trim() || undefined }
              : { tableId: dest.tableId, keyField: dest.keyField, mapping: dest.mapping }),
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

      <div className="mt-5">
        <ImportDestination
          columns={preview.columns}
          defaultName={name || "Imported"}
          busy={busy}
          onApply={doImport}
        />
      </div>
    </main>
  );
}
