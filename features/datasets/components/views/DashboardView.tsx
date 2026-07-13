"use client";
import { useMemo } from "react";
import { FieldMeta, Row } from "@/core/types";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell as PCell,
} from "recharts";
import { Card } from "@/components/ui/card";

// ── Auto-dashboard: derives KPI cards + charts purely from field metadata. ──

const CHART = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const toNum = (v: unknown) => {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};

const fmt = (n: number, currency?: string) =>
  currency
    ? new Intl.NumberFormat("en-US", { style: "currency", currency, notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n)
    : new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);

// Fixed 128px-tall KPI card. Label is single-line; the number sits at a fixed
// offset so numbers baseline-align across every card; sub pins to the bottom.
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex h-32 flex-col p-4">
      <div className="truncate text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 truncate font-display text-[28px] font-extrabold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-auto h-4 truncate font-mono-data text-[11px] text-muted-foreground">
        {sub ?? ""}
      </div>
    </Card>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-3 truncate text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      {children}
    </Card>
  );
}

export function DashboardView({ fields, rows }: { fields: FieldMeta[]; rows: Row[] }) {
  const numericFields = fields.filter((f) => ["number", "currency", "percent"].includes(f.type)).slice(0, 4);
  const catFields = fields.filter((f) => f.type === "status" || f.type === "singleSelect").slice(0, 2);

  const kpis = useMemo(
    () =>
      numericFields.map((f) => {
        const nums = rows.map((r) => toNum(r[f.id])).filter((n): n is number => n !== null);
        const sum = nums.reduce((a, b) => a + b, 0);
        return { f, sum, avg: nums.length ? sum / nums.length : 0, count: nums.length };
      }),
    [numericFields, rows]
  );

  const catData = useMemo(
    () =>
      catFields.map((f) => {
        const counts = new Map<string, number>();
        for (const r of rows) {
          const k = String(r[f.id] ?? "—");
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return { f, data: [...counts.entries()].map(([name, value]) => ({ name, value })) };
      }),
    [catFields, rows]
  );

  const barData = useMemo(() => {
    if (!numericFields[0] || !catFields[0]) return null;
    const nf = numericFields[0], cf = catFields[0];
    const sums = new Map<string, number>();
    for (const r of rows) {
      const k = String(r[cf.id] ?? "—");
      sums.set(k, (sums.get(k) ?? 0) + (toNum(r[nf.id]) ?? 0));
    }
    return { nf, cf, data: [...sums.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })) };
  }, [numericFields, catFields, rows]);

  const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* KPI row: 2 cols on mobile → 4 on desktop, uniform 128px cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Rows" value={rows.length.toLocaleString()} />
        {kpis.slice(0, 3).map(({ f, sum, avg }) => (
          <StatCard
            key={f.id}
            label={f.displayName}
            value={fmt(sum, f.currency)}
            sub={`avg ${fmt(avg, f.currency)}`}
          />
        ))}
      </div>

      {/* Charts: stack on mobile → 2-up on desktop */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {barData && (
          <ChartPanel title={`${barData.nf.displayName} by ${barData.cf.displayName}`}>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} interval={0} height={24} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={72}>
                    {barData.data.map((_, i) => <PCell key={i} fill={CHART[i % CHART.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartPanel>
        )}
        {catData.map(({ f, data }) => (
          <ChartPanel key={f.id} title={`${f.displayName} distribution`}>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} stroke="hsl(var(--card))">
                    {data.map((_, i) => <PCell key={i} fill={CHART[i % CHART.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {data.map((d, i) => (
                <span key={d.name} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: CHART[i % CHART.length] }} />
                  {d.name} <span className="font-mono-data text-muted-foreground/70">{d.value}</span>
                </span>
              ))}
            </div>
          </ChartPanel>
        ))}
      </div>
    </div>
  );
}
