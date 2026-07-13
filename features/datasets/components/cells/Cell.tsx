"use client";
import { FieldMeta } from "@/features/datasets/types";
import { Check, Minus, ExternalLink, Mail, Phone, ChevronRight, MapPin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { ExpandableText } from "@/shared/ui/expandable-text";

// ── The renderer. Input: metadata + value. It has no idea where data came from. ──

// Status / select values render as colored text (no filled background) —
// the color carries the meaning.
export const statusColor = (options: FieldMeta["options"], value: string) => {
  const opt = options?.find((o) => o.value === value);
  return opt ? `var(--c-${opt.color}-fg)` : "hsl(var(--muted-foreground))";
};

function Tag({ value, options }: { value: string; options?: FieldMeta["options"] }) {
  return (
    <span
      className="whitespace-nowrap text-[13px] font-semibold"
      style={{ color: statusColor(options, value) }}
    >
      {value}
    </span>
  );
}

const fmtNum = new Intl.NumberFormat("en-US");
const fmtCur = (v: number, c = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(v);

const toNum = (v: unknown) => {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};

// Parse a date value without the UTC off-by-one: a bare YYYY-MM-DD is read as a
// local date, not UTC midnight (which would render as the previous day west of UTC).
const parseDateValue = (v: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

export function Cell({ field, value, wrap = false }: { field: FieldMeta; value: unknown; wrap?: boolean }) {
  if (value === null || value === undefined || String(value).trim() === "")
    return <span className="text-muted-foreground/60">—</span>;
  const s = String(value);

  switch (field.type) {
    case "status":
    case "singleSelect":
      return <Tag value={s} options={field.options} />;
    case "multiSelect":
      return (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {s.split(",").map((t, i, arr) => (
            <span key={i} className="whitespace-nowrap text-[13px] font-semibold" style={{ color: statusColor(field.options, t.trim()) }}>
              {t.trim()}
              {i < arr.length - 1 && <span className="text-muted-foreground/40">,</span>}
            </span>
          ))}
        </span>
      );
    case "boolean": {
      const truthy = /^(true|yes|y|1)$/i.test(s);
      return truthy ? (
        <Check size={15} className="text-success" strokeWidth={3} />
      ) : (
        <Minus size={15} className="text-muted-foreground/60" />
      );
    }
    case "currency": {
      const n = toNum(value);
      return <span className="font-mono-data text-[13px] tabular-nums">{n !== null ? fmtCur(n, field.currency) : s}</span>;
    }
    case "number": {
      const n = toNum(value);
      return <span className="font-mono-data text-[13px] tabular-nums">{n !== null ? fmtNum.format(n) : s}</span>;
    }
    case "percent":
      return <span className="font-mono-data text-[13px] tabular-nums">{s.endsWith("%") ? s : `${s}%`}</span>;
    case "date": {
      const d = parseDateValue(s);
      return (
        <span className="font-mono-data text-[13px] text-muted-foreground">
          {d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : s}
        </span>
      );
    }
    case "datetime": {
      const d = parseDateValue(s);
      return (
        <span className="whitespace-nowrap font-mono-data text-[13px] text-muted-foreground">
          {d
            ? d.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : s}
        </span>
      );
    }
    case "time":
    case "duration":
      return <span className="whitespace-nowrap font-mono-data text-[13px] text-muted-foreground">{s}</span>;
    case "year":
      return <span className="font-mono-data text-[13px] tabular-nums">{s}</span>;
    case "rating": {
      const n = toNum(value);
      if (n === null) return <span className="font-mono-data text-[13px]">{s}</span>;
      const full = Math.max(0, Math.min(5, Math.round(n)));
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="text-[13px] tracking-tight" style={{ color: "var(--c-amber-fg)" }}>
            {"★".repeat(full)}
            <span className="text-muted-foreground/40">{"★".repeat(5 - full)}</span>
          </span>
          <span className="font-mono-data text-[11.5px] tabular-nums text-muted-foreground">{n}</span>
        </span>
      );
    }
    case "color": {
      const valid = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            className="size-3.5 shrink-0 rounded ring-1 ring-border"
            style={{ background: valid ? s : "transparent" }}
          />
          <span className="font-mono-data text-[12px] uppercase">{s}</span>
        </span>
      );
    }
    case "uuid":
      return (
        <span title={s} className="font-mono-data text-[11.5px] text-muted-foreground">
          {s.length > 13 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s}
        </span>
      );
    case "coordinates":
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono-data text-[12px]">
          <MapPin size={12} className="shrink-0 opacity-50" />
          {s}
        </span>
      );
    case "email":
      return (
        <a href={`mailto:${s}`} className="inline-flex items-center gap-1.5 hover:underline underline-offset-2" style={{ color: "var(--c-sky-fg)" }}>
          <Mail size={13} className="opacity-70" />
          {s}
        </a>
      );
    case "phone":
      return (
        <a href={`tel:${s}`} className="inline-flex items-center gap-1.5 whitespace-nowrap hover:underline underline-offset-2">
          <Phone size={13} className="shrink-0 opacity-50" />
          <span className="font-mono-data text-[13px]">{s}</span>
        </a>
      );
    case "url":
      return (
        <ExpandableText
          text={s}
          label={field.displayName}
          maxPreviewWidth="220px"
          lines={1}
          expanded={
            <a
              href={s}
              target="_blank"
              rel="noreferrer"
              className="break-all hover:underline underline-offset-2"
              style={{ color: "var(--c-sky-fg)" }}
            >
              {s}
            </a>
          }
        >
          <span
            className="inline-flex max-w-[220px] items-center gap-1.5 hover:underline underline-offset-2"
            style={{ color: "var(--c-sky-fg)" }}
          >
            <ExternalLink size={13} className="shrink-0 opacity-70" />
            <span className="truncate">{s.replace(/^https?:\/\/(www\.)?/, "")}</span>
          </span>
        </ExpandableText>
      );
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={s} alt="" className="h-8 w-8 rounded-md object-cover ring-1 ring-border" />;
    case "json": {
      // Summarize instead of dumping raw JSON; click opens the details.
      let summary = "details";
      let pretty = s;
      try {
        const parsed = JSON.parse(s);
        pretty = JSON.stringify(parsed, null, 2);
        if (Array.isArray(parsed)) summary = `${parsed.length} item${parsed.length === 1 ? "" : "s"}`;
        else if (parsed && typeof parsed === "object") summary = `${Object.keys(parsed).length} values`;
      } catch {
        /* leave raw */
      }
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {summary}
              <ChevronRight className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <pre className="max-h-64 overflow-auto p-3 font-mono-data text-[11px] leading-relaxed">
              {pretty}
            </pre>
          </PopoverContent>
        </Popover>
      );
    }
    case "longText":
      return (
        <ExpandableText
          text={s}
          label={field.displayName}
          maxPreviewWidth="320px"
          previewClassName="text-muted-foreground"
        />
      );
    default: {
      const expandable = s.length > 32 || s.includes("\n");
      if (expandable) {
        return (
          <ExpandableText
            text={s}
            label={field.displayName}
            lines={wrap ? 2 : 1}
            maxPreviewWidth={wrap ? "420px" : "100%"}
          />
        );
      }
      return wrap ? (
        <span className="line-clamp-2 max-w-[420px] whitespace-normal break-words">{s}</span>
      ) : (
        <span className="whitespace-nowrap">{s}</span>
      );
    }
  }
}
