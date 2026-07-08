import Link from "next/link";
import { ArrowRight, Table2, Kanban, Images, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    title: "Type inference",
    body: "Emails, currencies, dates, statuses, URLs, images: 13 column types detected from the values themselves. You never map a schema.",
  },
  {
    title: "Field registry",
    body: "Rename or hide fields. Your changes persist, and re-imports never overwrite them.",
  },
  {
    title: "Views from metadata",
    body: "Grid, board, gallery, and dashboard appear when the data supports them. Edit statuses inline or drag cards between lanes.",
  },
  {
    title: "Files and webhooks",
    body: "Upload CSV, XLSX, or JSON. Or POST raw JSON to the API and the dataset shows up ready to use.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Send data",
    body: "Upload a file or POST JSON to /api/datasets. Nested webhook payloads flatten automatically.",
  },
  {
    n: "2",
    title: "The engine types it",
    body: "Each column gets a semantic type, a field registry entry, and a confidence score.",
  },
  {
    n: "3",
    title: "Work with it",
    body: "Sort, search, and filter the grid. Drag kanban cards. Read the auto-built dashboard.",
  },
];

const VIEW_CHIPS = [
  { icon: Table2, label: "Grid" },
  { icon: Kanban, label: "Board" },
  { icon: Images, label: "Gallery" },
  { icon: Gauge, label: "Dashboard" },
];

export function Landing() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 md:py-24 lg:grid-cols-2 lg:items-center">
        <div className="rise flex flex-col gap-6">
          <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-tight md:text-6xl">
            Dump it in the SWAMP.
            <br />
            <span className="text-muted-foreground">Get a clean UI out.</span>
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Throw in a webhook, JSON, a CSV, or a spreadsheet. SWAMP reads it, types every
            column, and builds the grid, board, gallery, and dashboard for you.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-11 gap-2">
              <Link href="/app">
                Launch the workspace
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11">
              <Link href="/app/import">Import data</Link>
            </Button>
          </div>
        </div>

        {/* Webhook snippet card */}
        <div className="rise">
          <div className="overflow-hidden rounded-xl border bg-card shadow-lg">
            <div className="border-b px-4 py-2.5 font-mono-data text-[11px] text-muted-foreground">
              POST /api/datasets?name=Orders
            </div>
            <pre className="overflow-x-auto whitespace-pre p-4 font-mono-data text-[12px] leading-[1.7] text-muted-foreground">
{`$ curl -X POST \\
   '…/api/datasets?name=Orders' \\
   -H 'content-type: application/json' \\
   -d '{ "data": [
        { "order_id": "ORD-7001",
          "total": 38.49,
          "status": "paid" }
   ] }'`}
            </pre>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t px-4 py-3 text-[12px] text-muted-foreground">
              <span className="font-mono-data text-success">200</span>
              <span>inferred</span>
              {VIEW_CHIPS.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]"
                >
                  <Icon className="size-3" />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
          <h2 className="mb-8 font-display text-3xl font-extrabold tracking-tight">
            What it does
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ title, body }) => (
              <div
                key={title}
                className="flex min-h-[150px] flex-col gap-2 rounded-xl border bg-card p-5 shadow-sm"
              >
                <h3 className="text-[15px] font-semibold">{title}</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="mx-auto w-full max-w-6xl px-4 py-16 md:py-20">
        <h2 className="mb-8 font-display text-3xl font-extrabold tracking-tight">
          How it works
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ n, title, body }) => (
            <div key={n} className="flex min-h-[140px] flex-col gap-2 rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-baseline gap-2.5">
                <span className="font-display text-xl font-extrabold text-brand">{n}</span>
                <h3 className="text-[15px] font-semibold">{title}</h3>
              </div>
              <p className="text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-14 text-center">
          <h2 className="max-w-xl font-display text-3xl font-extrabold tracking-tight">
            Three sample datasets are loaded.
          </h2>
          <p className="max-w-md text-[14.5px] text-muted-foreground">
            Open the workspace, edit a status, drag a card, filter the grid.
          </p>
          <Button asChild size="lg" className="h-11 gap-2">
            <Link href="/app">
              Launch the workspace
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

    </>
  );
}
