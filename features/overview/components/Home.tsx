"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { DatasetSummary } from "@/core/types";
import {
  UploadCloud, Trash2, Webhook, FileSpreadsheet, Braces, Database,
  Table2, Kanban, Images, Gauge, ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

const VIEW_ICON: Record<string, React.ReactNode> = {
  grid: <Table2 className="size-3" />, kanban: <Kanban className="size-3" />,
  gallery: <Images className="size-3" />, dashboard: <Gauge className="size-3" />,
};
const SRC_ICON: Record<string, React.ReactNode> = {
  csv: <FileSpreadsheet className="size-4" />, xlsx: <FileSpreadsheet className="size-4" />,
  json: <Braces className="size-4" />, webhook: <Webhook className="size-4" />,
  sheet: <FileSpreadsheet className="size-4" />,
};

export function Home({ initial }: { initial: DatasetSummary[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [datasets, setDatasets] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDatasets(initial), [initial]);

  const highlightImport = searchParams.get("import") === "1";
  useEffect(() => {
    if (highlightImport) dropRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightImport]);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/datasets", { method: "POST", body: fd });
      const json = await res.json();
      setBusy(false);
      if (!res.ok) {
        setError(json.error ?? "Import failed");
        toast.error(json.error ?? "Import failed");
        return;
      }
      toast.success("Dataset imported");
      // Navigate first, then refresh so the shared (app) layout — which renders the
      // sidebar + overview dataset list — refetches and shows the new dataset without
      // a manual reload.
      router.push(`/d/${json.id}`);
      router.refresh();
    },
    [router]
  );

  const remove = async (id: string, name: string) => {
    await fetch(`/api/datasets/${id}`, { method: "DELETE" });
    setDatasets((d) => d.filter((x) => x.id !== id));
    toast.success(`Deleted “${name}”`);
    router.refresh();
  };

  return (
    <main className="rise mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:p-8">
      {/* ── compact app-home header ── */}
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">
          Datasets
        </h1>
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
          Upload a CSV, XLSX, or JSON file, or send data to the webhook endpoint. Types,
          fields, and views come from the data itself.
        </p>
      </header>

      {/* ── import dropzone ── */}
      <div
        ref={dropRef}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed p-7 text-center transition-all sm:p-8",
          drag
            ? "border-brand bg-brand/5"
            : highlightImport
              ? "border-brand/60 ring-4 ring-brand/10"
              : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
        )}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.json"
          hidden
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <UploadCloud className={cn("mx-auto mb-2.5 size-6", busy ? "animate-pulse text-brand" : "text-muted-foreground")} />
        <div className="text-sm font-medium">
          {busy ? "Inferring schema…" : "Drop CSV / XLSX / JSON, or click to browse"}
        </div>
        <div className="mt-1.5 px-2 font-mono-data text-[10.5px] leading-relaxed text-muted-foreground">
          webhooks: POST raw JSON to <span className="whitespace-nowrap">/api/datasets?name=…</span>
        </div>
        {error && <div className="mt-3 text-[12.5px] text-destructive">{error}</div>}
      </div>

      {/* ── connect a live source ── */}
      <Link
        href="/app/connect"
        className="group flex items-center gap-3 rounded-xl border p-4 transition-colors hover:border-brand/40 hover:bg-muted/30"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileSpreadsheet className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium group-hover:text-brand">Connect a Google Sheet</div>
          <div className="text-[12.5px] text-muted-foreground">
            Live-sync a Google Form&rsquo;s responses. New submissions append on their own.
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
      </Link>

      {/* ── datasets ── */}
      <section className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {datasets.map((d, i) => (
            <Card
              key={d.id}
              className="group relative flex min-h-[128px] flex-col p-4 transition-colors hover:border-brand/40"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <Link href={`/d/${d.id}`} className="flex flex-1 flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {SRC_ICON[d.source.kind] ?? <Database className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 pr-7 font-semibold leading-tight group-hover:text-brand">
                      {d.name}
                    </div>
                    <div className="mt-1 truncate font-mono-data text-[10.5px] text-muted-foreground">
                      {d.rowCount} rows
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  {d.recommendedViews.map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] capitalize text-muted-foreground"
                    >
                      {VIEW_ICON[v]} {v}
                    </span>
                  ))}
                </div>
              </Link>
              <ConfirmDialog
                title={`Delete “${d.name}”?`}
                description="This permanently removes the dataset and all of its rows."
                confirmLabel="Delete"
                onConfirm={() => remove(d.id, d.name)}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label="Delete dataset"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
            </Card>
          ))}
          {datasets.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No datasets yet. Run <code className="font-mono-data text-xs">npm run seed</code> or drop a file above.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
