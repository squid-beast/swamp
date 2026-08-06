"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

// The entity-relationship diagram: every table as a card, every link field as
// an edge. Hand-written SVG — a base has a handful of tables, and dagre
// (~30 kB) or elkjs (~500 kB) buy nothing at this node count.
//
// Layout: columns by LINK DEPTH. Tables nothing points at sit left; a table
// linked from column n sits at n+1. Cycles (self-links, mutual links) are cut
// by the visited set and simply stay in the earliest column they reached.

interface ErdField {
  id: string;
  name: string;
  key: string;
  type: string;
  is_primary: boolean;
  options: { targetTableId?: string; symmetricFieldId?: string };
}

interface ErdTable {
  id: string;
  name: string;
  fields: ErdField[];
}

const CARD_W = 220;
const ROW_H = 22;
const HEAD_H = 34;
const GAP_X = 90;
const GAP_Y = 28;
const MAX_ROWS = 12;

export function Erd({ baseId }: { baseId: string }) {
  const [tables, setTables] = React.useState<ErdTable[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void fetch(`/api/bases/${baseId}/meta`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load the schema");
        return (await r.json()) as { tables: ErdTable[] };
      })
      .then((b) => alive && setTables(b.tables))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [baseId]);

  const layout = React.useMemo(() => {
    if (!tables) return null;

    // Edges: link field → target table.
    //
    // ── Symmetric pairs are ONE relationship ──
    //
    // createLinkField always writes a mirror field on the target pointing back
    // (options.symmetricFieldId), so a naive pass yields both directions. That
    // makes every table "linked to", leaves the layout with no roots, and
    // collapses the whole diagram into a single column. Keep one direction per
    // pair — the half whose field id sorts first, so the choice is stable across
    // renders rather than dependent on iteration order.
    const all: { fromTable: string; fromField: ErdField; toTable: string }[] = [];
    for (const t of tables) {
      for (const f of t.fields) {
        if (f.type === "link" && f.options?.targetTableId) {
          if (tables.some((x) => x.id === f.options.targetTableId)) {
            all.push({ fromTable: t.id, fromField: f, toTable: f.options.targetTableId });
          }
        }
      }
    }

    const byFieldId = new Map(all.map((e) => [e.fromField.id, e]));
    const edges = all.filter((e) => {
      const mate = e.fromField.options?.symmetricFieldId;
      if (!mate || !byFieldId.has(mate)) return true; // one-sided link: keep it
      return e.fromField.id < mate;
    });

    // Column = link depth. Roots are tables that link OUT but are not linked TO
    // (or are isolated); everything else falls where the BFS first reaches it.
    const linkedTo = new Set(edges.map((e) => e.toTable));
    const col = new Map<string, number>();
    const queue: string[] = [];
    for (const t of tables) {
      if (!linkedTo.has(t.id)) {
        col.set(t.id, 0);
        queue.push(t.id);
      }
    }
    // A fully-cyclic base has no roots — seed with the first table.
    if (!queue.length && tables.length) {
      col.set(tables[0].id, 0);
      queue.push(tables[0].id);
    }
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges) {
        if (e.fromTable === id && !col.has(e.toTable)) {
          col.set(e.toTable, (col.get(id) ?? 0) + 1);
          queue.push(e.toTable);
        }
      }
    }
    for (const t of tables) if (!col.has(t.id)) col.set(t.id, 0);

    // Positions: stack each column.
    const columns = new Map<number, ErdTable[]>();
    for (const t of tables) {
      const c = col.get(t.id)!;
      columns.set(c, [...(columns.get(c) ?? []), t]);
    }

    const pos = new Map<string, { x: number; y: number; h: number }>();
    let maxX = 0;
    let maxY = 0;
    for (const [c, list] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
      let y = 0;
      for (const t of list) {
        const rows = Math.min(t.fields.length, MAX_ROWS);
        const h = HEAD_H + rows * ROW_H + (t.fields.length > MAX_ROWS ? ROW_H : 0);
        const x = c * (CARD_W + GAP_X);
        pos.set(t.id, { x, y, h });
        y += h + GAP_Y;
        maxX = Math.max(maxX, x + CARD_W);
        maxY = Math.max(maxY, y);
      }
    }

    return { edges, pos, width: maxX + 20, height: maxY + 20 };
  }, [tables]);

  if (error) {
    return <p className="p-8 text-[13px] text-destructive">{error}</p>;
  }
  if (!tables || !layout) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  const { edges, pos, width, height } = layout;

  /** Where a field row's centre sits, for edge anchoring. */
  const fieldY = (t: ErdTable, f: ErdField) => {
    const p = pos.get(t.id)!;
    const i = Math.min(t.fields.findIndex((x) => x.id === f.id), MAX_ROWS - 1);
    return p.y + HEAD_H + (Math.max(i, 0) + 0.5) * ROW_H;
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="erd">
      <svg width={width} height={height} className="min-w-full">
        {/* Edges under the cards */}
        {edges.map((e, i) => {
          const from = pos.get(e.fromTable)!;
          const to = pos.get(e.toTable)!;
          const fromT = tables.find((t) => t.id === e.fromTable)!;
          const x1 = from.x + CARD_W;
          const y1 = fieldY(fromT, e.fromField);
          const x2 = to.x;
          const y2 = to.y + HEAD_H / 2;
          const bend = Math.max(40, (x2 - x1) / 2);
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
              fill="none"
              className="stroke-brand/50"
              strokeWidth={1.5}
            />
          );
        })}

        {/* Cards */}
        {tables.map((t) => {
          const p = pos.get(t.id)!;
          const shown = t.fields.slice(0, MAX_ROWS);
          const extra = t.fields.length - shown.length;
          return (
            <g key={t.id} transform={`translate(${p.x}, ${p.y})`}>
              <rect
                width={CARD_W}
                height={p.h}
                rx={8}
                className="fill-card stroke-border"
                strokeWidth={1}
              />
              <rect width={CARD_W} height={HEAD_H} rx={8} className="fill-muted/60" />
              <text x={12} y={HEAD_H / 2 + 4} className="fill-foreground text-[13px] font-semibold">
                {t.name}
              </text>
              {shown.map((f, i) => (
                <text
                  key={f.id}
                  x={12}
                  y={HEAD_H + (i + 0.7) * ROW_H}
                  className={
                    f.is_primary
                      ? "fill-foreground text-[11px] font-medium"
                      : f.type === "link"
                        ? "fill-brand text-[11px]"
                        : "fill-muted-foreground text-[11px]"
                  }
                >
                  {f.name}
                  <tspan className="fill-muted-foreground/60"> · {f.type}</tspan>
                </text>
              ))}
              {extra > 0 && (
                <text
                  x={12}
                  y={HEAD_H + (shown.length + 0.7) * ROW_H}
                  className="fill-muted-foreground/60 text-[11px]"
                >
                  … {extra} more
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="pt-2 text-[11px] text-muted-foreground">
        Each edge is a link field. Open a table to change its schema:{" "}
        {tables.map((t, i) => (
          <React.Fragment key={t.id}>
            {i > 0 && " · "}
            <Link href={`/app/t/${t.id}`} className="text-brand hover:underline">
              {t.name}
            </Link>
          </React.Fragment>
        ))}
      </p>
    </div>
  );
}
