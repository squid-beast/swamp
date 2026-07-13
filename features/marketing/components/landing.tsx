import Link from "next/link";
import { ArrowRight, Table2, Kanban, Images, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    title: "it just knows",
    body: "emails, money, dates, statuses, links, pics — 13 column types sniffed straight from the values. zero schema mapping. big brain energy.",
  },
  {
    title: "ur edits are sacred",
    body: "rename or hide fields and it sticks. re-imports can never overwrite your changes. respectfully.",
  },
  {
    title: "views spawn themselves",
    body: "grid, board, gallery, dashboard — they appear when the data supports them. edit statuses inline, drag cards between lanes. goes brrr.",
  },
  {
    title: "eats everything",
    body: "CSV, XLSX, JSON — or POST raw webhook chaos at the API and the dataset shows up ready to use. om nom.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "yeet data",
    body: "upload a file or POST JSON to /api/datasets. nested webhook payloads flatten themselves. fr.",
  },
  {
    n: "2",
    title: "engine cooks",
    body: "every column gets a semantic type, a field registry entry, and a confidence score. no thoughts, just types.",
  },
  {
    n: "3",
    title: "you vibe",
    body: "sort, search, filter the grid. drag kanban cards. read the dashboard that built itself. gg.",
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
            yeet ur data into the SWAMP.
            <br />
            <span className="text-muted-foreground">clean UI comes out. no cap.</span>
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
            webhook, JSON, CSV, that cursed spreadsheet — throw it in. SWAMP reads it, types
            every column, and speedruns you a grid, board, gallery and dashboard. it just works.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-11 gap-2">
              <Link href="/app">
                enter the swamp
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11">
              <Link href="/app/import">feed it data</Link>
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
              <span>cooked</span>
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
            what it do
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
          the lore
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
            3 sample datasets already in there. free real estate.
          </h2>
          <p className="max-w-md text-[14.5px] text-muted-foreground">
            open the workspace, poke a status, drag a card, filter the grid. touch data, not grass.
          </p>
          <Button asChild size="lg" className="h-11 gap-2">
            <Link href="/app">
              enter the swamp
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

    </>
  );
}
