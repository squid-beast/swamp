import { cn } from "@/shared/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
// The product, rendered — not screenshotted.
//
// This is real HTML and CSS, not a PNG. Three reasons, and they're all the kind
// that show up in a Lighthouse report:
//
//   • A 400KB hero screenshot IS your Largest Contentful Paint. This weighs
//     nothing and paints with the document.
//   • It's crisp on every display and it respects dark mode, because it IS the
//     theme rather than a picture of it.
//   • A screenshot goes stale the first time somebody changes a colour. This
//     can't, because it's built from the same tokens the app is.
//
// It's decorative — the information is in the prose beside it — so it's hidden
// from screen readers rather than being narrated cell by cell.
// ════════════════════════════════════════════════════════════════════════════

interface Row {
  company: string;
  stage: string;
  tone: "won" | "open" | "lost";
  owner: string;
  deals: number;
  total: string;
}

const ROWS: Row[] = [
  { company: "Northwind",   stage: "Won",         tone: "won",  owner: "AM", deals: 3, total: "$48,200" },
  { company: "Initech",     stage: "In review",   tone: "open", owner: "RK", deals: 1, total: "$12,000" },
  { company: "Globex",      stage: "Won",         tone: "won",  owner: "AM", deals: 5, total: "$91,750" },
  { company: "Soylent",     stage: "Negotiating", tone: "open", owner: "JP", deals: 2, total: "$27,400" },
  { company: "Umbrella",    stage: "Lost",        tone: "lost", owner: "RK", deals: 1, total: "$0" },
  { company: "Hooli",       stage: "In review",   tone: "open", owner: "JP", deals: 4, total: "$63,900" },
];

// Monochrome, so status reads by weight instead of hue: a filled chip for won, a
// soft one for in-flight, a struck-through one for lost.
const TONE: Record<Row["tone"], string> = {
  won: "bg-foreground text-background",
  open: "bg-muted text-foreground",
  lost: "bg-muted/60 text-muted-foreground line-through",
};

export function ProductFrame({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/5 dark:shadow-black/40",
        className
      )}
    >
      {/* Toolbar — the row of things you actually press */}
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-1.5 pr-2">
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          <span className="size-2.5 rounded-full bg-muted-foreground/50" />
        </div>

        <Chip active>Grid</Chip>
        <Chip>Kanban</Chip>
        <Chip>Calendar</Chip>

        <span className="mx-1 h-4 w-px bg-border" />

        <Chip accent>Stage is Won</Chip>
        <Chip>Sort: Total ↓</Chip>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Presence. Two people are in here with you — which is the whole point. */}
          <span className="grid size-6 place-items-center rounded-full bg-foreground text-[10px] font-semibold text-background ring-2 ring-card">
            AM
          </span>
          <span className="-ml-3 grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold text-foreground ring-2 ring-card">
            RK
          </span>
        </div>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_1fr] border-b bg-muted/20 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <Cell head>Company</Cell>
        <Cell head>Stage</Cell>
        <Cell head>Owner</Cell>
        <Cell head>
          Deals <Badge>link</Badge>
        </Cell>
        <Cell head>
          Total <Badge>rollup</Badge>
        </Cell>
      </div>

      {ROWS.map((row, i) => (
        <div
          key={row.company}
          className={cn(
            "grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_1fr] border-b text-[13px] last:border-b-0",
            i === 2 && "bg-primary/[0.04]"
          )}
        >
          <Cell className="font-medium text-foreground">
            {row.company}
            {/* A comment thread, on a row. */}
            {i === 2 && (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                2
              </span>
            )}
          </Cell>

          <Cell>
            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", TONE[row.tone])}>
              {row.stage}
            </span>
          </Cell>

          <Cell className="text-muted-foreground">{row.owner}</Cell>

          <Cell>
            <span className="rounded border bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {row.deals} linked
            </span>
          </Cell>

          <Cell className="font-mono-data tabular-nums text-foreground">{row.total}</Cell>
        </div>
      ))}

      {/* Footer aggregate — the thing a spreadsheet makes you write a formula for */}
      <div className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_1fr] border-t bg-muted/30 text-[12px] text-muted-foreground">
        <Cell>6 records</Cell>
        <Cell />
        <Cell />
        <Cell>16 linked</Cell>
        <Cell className="font-mono-data tabular-nums text-foreground">$243,250</Cell>
      </div>
    </div>
  );
}

function Cell({
  children,
  head,
  className,
}: {
  children?: React.ReactNode;
  head?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 border-r px-3 last:border-r-0",
        head ? "py-2" : "py-2.5",
        className
      )}
    >
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-medium normal-case tracking-normal text-primary">
      {children}
    </span>
  );
}

function Chip({
  children,
  active,
  accent,
}: {
  children: React.ReactNode;
  active?: boolean;
  accent?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded px-2 py-1 text-[11.5px]",
        active && "bg-background font-medium text-foreground shadow-sm",
        accent && "bg-primary/10 text-primary",
        !active && !accent && "text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}
