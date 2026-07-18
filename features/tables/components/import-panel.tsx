"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { cn } from "@/shared/lib/utils";

// Import a file → a real table.
//
// The whole thing is one POST. The server parses, infers every column's type,
// creates the base (or reuses one), the table, the fields, a default grid view,
// and the records — then hands back a table id and we navigate to it.

const ACCEPT = ".csv,.tsv,.xlsx,.xls,.json";

export function ImportPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const baseId = params.get("baseId");

  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  const pick = (f: File | null) => {
    setFile(f);
    // Prefill the name from the filename, but let it be overridden. Nobody wants
    // a table called "export (3) FINAL v2".
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);

    const form = new FormData();
    form.append("file", file);
    if (name.trim()) form.append("name", name.trim());
    if (baseId) form.append("baseId", baseId);

    try {
      const res = await fetch("/api/import", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Import failed");

      toast.success(
        `${body.rowCount.toLocaleString()} rows · ${body.fieldCount} fields`
      );
      // refresh() so the sidebar picks up the new base/table before we land on it.
      router.refresh();
      router.push(`/app/t/${body.tableId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  const submitUrl = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);

    try {
      const res = await fetch("/api/import/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          name: name.trim() || undefined,
          baseId: baseId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Import failed");

      toast.success(
        `${body.rowCount.toLocaleString()} rows · ${body.fieldCount} fields`
      );
      router.refresh();
      router.push(`/app/t/${body.tableId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-lg p-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">
        Import data
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        CSV, Excel or JSON — from a file or a public link. Every column gets a type,
        and you get a table.
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
            <p className="text-[12px] text-muted-foreground">
              {(file.size / 1024).toFixed(0)} KB
            </p>
            <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
              Choose another
            </Button>
          </>
        ) : (
          <>
            <UploadCloud className="size-6 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">
              Drop a file here, or
            </p>
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

      {file && (
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="table-name" className="text-[12px] text-muted-foreground">
            Table name
          </Label>
          <Input
            id="table-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
      )}

      <Button
        onClick={submit}
        disabled={!file || busy}
        className="mt-4 w-full gap-2"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {busy ? "Importing…" : "Import"}
      </Button>

      <div className="mt-8 flex items-center gap-3 text-[12px] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or paste a link
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <Label htmlFor="import-url" className="text-[12px] text-muted-foreground">
          Import from a URL
        </Label>
        <div className="flex gap-2">
          <Input
            id="import-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitUrl()}
            placeholder="https://…/data.csv or a public Google Sheet"
          />
          <Button
            variant="outline"
            onClick={submitUrl}
            disabled={!url.trim() || busy}
            className="shrink-0 gap-2"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Fetch
          </Button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          A public CSV or JSON link, or a shared Google Sheet.
        </p>
      </div>
    </main>
  );
}
