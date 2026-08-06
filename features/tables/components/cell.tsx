"use client";

import * as React from "react";
import { Check, Minus, Star } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { formatAutoNumber, isReadOnlyField, type Field } from "../types";
import { LinkCell } from "./link-cell";
import { Markdown } from "./markdown";
import { AttachmentCell } from "./attachment-cell";
import { ButtonCell } from "./button-cell";
import { UserCell } from "./user-cell";
import { BarcodeCell } from "./barcode-cell";

// ════════════════════════════════════════════════════════════════════════════
// One cell.
//
// The old Cell.tsx was a clean read-only renderer across all 23 types — and that
// was the whole problem. It never wrote. The ONLY interactive cell in the entire
// grid was SelectCell; everything else had to be edited through a side-panel form.
//
// This is its editable twin: display state and edit state for each type.
//
// ── The renderer interface ──
//
// Everything here takes (field, value, onChange) and nothing else. It does not
// know about rows, tables, or the grid. That is deliberate: it is the seam a
// canvas renderer would slot into later, and keeping it narrow now is what makes
// that possible without a rewrite.
// ════════════════════════════════════════════════════════════════════════════

export interface CellProps {
  field: Field;
  value: unknown;
  onChange: (next: unknown) => void;

  /** Link cells write through their own endpoint, so they need the row's identity. */
  recordId?: string;
  tableId?: string;
  onLinksChanged?: () => void;

  /**
   * Editing is CONTROLLED by the grid, not owned by the cell.
   *
   * The cell used to flip its own `editing` flag on click. That works fine until
   * you want type-to-replace — the grid sees the keystroke, not the cell, so the
   * grid has to be the one that says "you're editing now". A cell that owns its
   * own edit state can never be driven by a keyboard it doesn't have focus on.
   */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

const str = (v: unknown) => (v == null ? "" : String(v));

export function CellView({
  field,
  value,
  onChange,
  editing,
  onEditingChange,
  recordId,
  tableId,
  onLinksChanged,
}: CellProps) {
  // A LINK is read-only as far as `data` goes — you can't type into it — but it is
  // very much editable: you pick records. It writes through the links endpoint, not
  // through a cell patch, so it has to be handled before the read-only check.
  if (field.type === "link" && recordId && tableId) {
    return (
      <LinkCell
        field={field}
        recordId={recordId}
        tableId={tableId}
        value={value}
        onChanged={onLinksChanged ?? (() => {})}
      />
    );
  }

  // Lookups return an ARRAY, because a many-link has many values and collapsing
  // that to one would be a lie.
  if (field.type === "lookup") {
    return <LookupCell value={value} />;
  }

  if (field.type === "rollup" || field.type === "count") {
    return <NumberCell field={field} value={value} />;
  }

  // A BUTTON is read-only as a value and very much not read-only as a thing: you
  // press it. For a URL button the value IS the href, compiled from a formula in
  // Postgres — which is why it has to be handled before the read-only check that
  // would otherwise render it as text.
  if (field.type === "button" && recordId) {
    return <ButtonCell field={field} recordId={recordId} value={value} />;
  }

  // A barcode/QR holds no value of its own — it draws the field it points at, and
  // `value` here is already that field's value (the catalog resolves the pointer).
  // Before the read-only check below, or it renders as the raw source text.
  if (field.type === "barcode" || field.type === "qr") {
    return <BarcodeCell field={field} value={value} />;
  }

  // PEOPLE. All three hold a uuid and have to show a name, so they share a cell.
  //
  // createdBy/modifiedBy are read-only — the database stamps them and refuses a
  // write (swamp_actor(), and `new.created_by = old.created_by` makes authorship
  // un-forgeable). They still have to be handled BEFORE the read-only check below,
  // or they render as a raw uuid, which means nothing to anyone.
  if (field.type === "user" || field.type === "createdBy" || field.type === "modifiedBy") {
    return (
      <UserCell
        field={field}
        value={value}
        onChange={onChange}
        editable={field.type === "user"}
      />
    );
  }

  // Computed fields have no value in `data` and can never be written directly.
  if (isReadOnlyField(field.type)) {
    return <ReadOnly field={field} value={value} />;
  }

  // An ATTACHMENT is writable, but not by typing. Without this it falls through to
  // TextCell and you get `[object Object]` in an input.
  if (field.type === "attachment") {
    return (
      <AttachmentCell field={field} tableId={tableId} value={value} onChange={onChange} />
    );
  }

  switch (field.type) {
    case "longText":
      return (
        <LongTextCell
          value={value}
          onChange={onChange}
          editing={editing}
          onEditingChange={onEditingChange}
          rich={!!field.options?.rich}
        />
      );
    case "boolean":
      return <BooleanCell value={value} onChange={onChange} />;
    case "rating":
      return <RatingCell field={field} value={value} onChange={onChange} />;
    case "singleSelect":
    case "status":
      return <SelectCell field={field} value={value} onChange={onChange} />;
    case "multiSelect":
      return <MultiSelectCell field={field} value={value} onChange={onChange} />;
    case "color":
      return <ColorCell value={value} onChange={onChange} />;
    default:
      return (
        <TextCell
          field={field}
          value={value}
          onChange={onChange}
          editing={editing}
          onEditingChange={onEditingChange}
        />
      );
  }
}

// ─── Text and everything text-shaped ────────────────────────────────────────

const INPUT_TYPE: Partial<Record<Field["type"], string>> = {
  number: "number",
  currency: "number",
  percent: "number",
  year: "number",
  date: "date",
  datetime: "datetime-local",
  time: "time",
  email: "email",
  url: "url",
  phone: "tel",
};

function TextCell({ field, value, onChange, editing, onEditingChange }: CellProps) {
  const [draft, setDraft] = React.useState(str(value));

  // The row can be refetched or patched underneath us. Take the new value when
  // we're not mid-edit; doing it unconditionally would clobber what's being typed.
  React.useEffect(() => {
    if (!editing) setDraft(str(value));
  }, [value, editing]);

  const commit = () => {
    onEditingChange?.(false);
    if (draft !== str(value)) onChange(draft === "" ? null : draft);
  };

  if (!editing) {
    return (
      <span
        className="block w-full truncate text-left text-[13px] tabular-nums"
        title={str(value)}
      >
        {formatDisplay(field, value) || <span className="text-muted-foreground/40">—</span>}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type={INPUT_TYPE[field.type] ?? "text"}
      value={draft}
      // Select-all on focus is what makes type-to-replace work: the grid opens the
      // editor on the first keystroke, and that keystroke should REPLACE the cell,
      // not append to it. Without this you type "5" into a cell holding "100" and
      // get "1005".
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // the grid's keydown must not also see this
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        // Escape REVERTS. A cell that commits on Escape is a cell that eats work.
        if (e.key === "Escape") {
          e.preventDefault();
          setDraft(str(value));
          onEditingChange?.(false);
        }
      }}
      className="w-full bg-transparent text-[13px] tabular-nums outline-none"
    />
  );
}

function formatDisplay(field: Field, value: unknown): string {
  const s = str(value);
  if (!s) return "";

  if (field.type === "currency") {
    // Strip the money furniture ($ , £ and friends) so "$1,000.00" formats, but
    // notice when stripping left NOTHING.
    //
    // `Number("")` is 0, not NaN — so "N/A" became "" became 0 and rendered as
    // $0.00. The guard below has always been here and has never once fired for the
    // value it names: the cell invented the exact number the comment forbids, and a
    // reader of the grid saw zero where the data says "not applicable".
    const cleaned = s.replace(/[^0-9.eE+-]/g, "");
    const n = cleaned === "" ? NaN : Number(cleaned);
    if (Number.isNaN(n)) return s; // "N/A" stays "N/A" — don't invent a number
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: field.options.currency ?? "USD",
      maximumFractionDigits: field.options.precision ?? 2,
    }).format(n);
  }

  if (field.type === "percent") {
    const n = Number(s);
    return Number.isNaN(n) ? s : `${n}%`;
  }

  if (field.type === "date" || field.type === "datetime") {
    // Parse a bare YYYY-MM-DD as LOCAL, not UTC. `new Date("2026-07-14")` is
    // midnight UTC, which renders as the 13th anywhere west of Greenwich — the
    // single most common date bug there is.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return field.type === "date" ? d.toLocaleDateString() : d.toLocaleString();
  }

  return s;
}

// ─── Long text ──────────────────────────────────────────────────────────────
//
// The one text-shaped type that isn't a single line. Two things make it different
// from TextCell:
//
//   1. Enter inserts a newline — long text is prose. ⌘/Ctrl+Enter commits, the
//      way every multi-line editor everywhere does it.
//   2. It is SELF-MANAGED when the parent doesn't drive editing. The grid passes
//      `onEditingChange` and opens the editor on double-click/type; the expanded
//      record passes neither, so there a click opens the textarea in place —
//      otherwise long text would be read-only in the one place you go to read it.

function LongTextCell({
  value,
  onChange,
  editing,
  onEditingChange,
  rich,
}: Omit<CellProps, "field"> & { rich?: boolean }) {
  const selfManaged = onEditingChange === undefined;
  const [focused, setFocused] = React.useState(false);
  const open = !!editing || (selfManaged && focused);

  const [draft, setDraft] = React.useState(str(value));
  React.useEffect(() => {
    if (!open) setDraft(str(value));
  }, [value, open]);

  const commit = () => {
    setFocused(false);
    onEditingChange?.(false);
    if (draft !== str(value)) onChange(draft === "" ? null : draft);
  };

  if (!open) {
    // Rich mode renders the markdown; the EDITOR stays a plain textarea either
    // way. Display mode, not storage format.
    return (
      <span
        onClick={() => selfManaged && setFocused(true)}
        className={cn(
          "block h-full w-full overflow-hidden whitespace-pre-wrap break-words text-left text-[13px] leading-snug",
          selfManaged && "cursor-text"
        )}
        title={str(value)}
      >
        {str(value) ? (
          rich ? (
            <Markdown text={str(value)} />
          ) : (
            str(value)
          )
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </span>
    );
  }

  return (
    <textarea
      autoFocus
      value={draft}
      onFocus={(e) => {
        // Put the caret at the end rather than selecting all — long text is
        // appended to far more often than it is replaced wholesale.
        const el = e.currentTarget;
        el.setSelectionRange(el.value.length, el.value.length);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // the grid's keydown must not also see this
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setDraft(str(value));
          setFocused(false);
          onEditingChange?.(false);
        }
      }}
      rows={selfManaged ? 4 : undefined}
      className={cn(
        "z-30 w-full resize-none rounded-sm bg-background text-[13px] leading-snug outline-none",
        selfManaged
          ? "min-h-[80px] p-0"
          : "absolute inset-0 min-h-[88px] border border-brand p-1.5 shadow-md"
      )}
    />
  );
}

// ─── Boolean ────────────────────────────────────────────────────────────────

function BooleanCell({ value, onChange }: Omit<CellProps, "field">) {
  const checked = value === true || value === "true" || value === "1" || value === "yes";
  return (
    <div className="flex h-full items-center">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
    </div>
  );
}

// ─── Rating ─────────────────────────────────────────────────────────────────

function RatingCell({ field, value, onChange }: CellProps) {
  const max = field.options.max ?? 5;
  const current = Number(value) || 0;

  return (
    <div className="flex h-full items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          // Clicking the current rating clears it. Otherwise a 1-star rating is
          // impossible to undo without a keyboard.
          onClick={() => onChange(current === n ? null : n)}
          aria-label={`${n} of ${max}`}
        >
          <Star
            className={cn(
              "size-3.5",
              n <= current ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </div>
  );
}

// ─── Select ─────────────────────────────────────────────────────────────────

const SWATCH: Record<string, string> = {
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  violet: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  teal: "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100",
  rose: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  sky: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  lime: "bg-lime-100 text-lime-900 dark:bg-lime-900/40 dark:text-lime-100",
  // orange/blue/gray are --swamp-* reference scales, which FLIP in dark mode
  // (100 goes deep, 900 goes pale) — so they need no dark: variants. The other
  // names are Tailwind's static palette and spell their dark look explicitly.
  orange: "bg-orange-100 text-orange-900",
  fuchsia: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  blue: "bg-blue-100 text-blue-900",
  gray: "bg-gray-100 text-gray-900",
};

function Pill({ value, color }: { value: string; color?: string }) {
  return (
    <span
      className={cn(
        "inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[12px]",
        SWATCH[color ?? ""] ?? "bg-muted text-foreground"
      )}
    >
      {value}
    </span>
  );
}

function SelectCell({ field, value, onChange }: CellProps) {
  const options = field.options.options ?? [];
  const current = str(value);
  const option = options.find((o) => o.value === current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="block w-full text-left outline-none">
        {current ? (
          <Pill value={current} color={option?.color} />
        ) : (
          <span className="text-[13px] text-muted-foreground/40">—</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
        {/* Clearing must be possible. The old SelectCell had no way to unset a
            value once set — a mis-click was permanent. */}
        <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground">
          Clear
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => onChange(o.value)}>
            <Pill value={o.value} color={o.color} />
            {o.value === current && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MultiSelectCell({ field, value, onChange }: CellProps) {
  const options = field.options.options ?? [];

  // Stored as a JSON ARRAY — not a comma-joined string. That's what gives the
  // query engine real containment operators (?| and ?&) and a GIN index instead
  // of a LIKE over a delimited blob.
  const current: string[] = Array.isArray(value)
    ? (value as string[])
    : value
      ? str(value).split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const toggle = (v: string) => {
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    onChange(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full flex-wrap gap-1 text-left outline-none">
        {current.length ? (
          current.map((v) => (
            <Pill key={v} value={v} color={options.find((o) => o.value === v)?.color} />
          ))
        ) : (
          <span className="text-[13px] text-muted-foreground/40">—</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={(e) => {
              e.preventDefault(); // keep the menu open — multi-select means several picks
              toggle(o.value);
            }}
          >
            <Pill value={o.value} color={o.color} />
            {current.includes(o.value) && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Colour ─────────────────────────────────────────────────────────────────

function ColorCell({ value, onChange }: Omit<CellProps, "field">) {
  const v = str(value) || "#000000";
  return (
    <div className="flex h-full items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="size-4 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <span className="text-[12px] tabular-nums text-muted-foreground">{str(value)}</span>
    </div>
  );
}

// ─── Lookup ─────────────────────────────────────────────────────────────────

function LookupCell({ value }: { value: unknown }) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];

  if (!values.length) {
    return <Minus className="size-3.5 text-muted-foreground/30" />;
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {values.map((v, i) => (
        <span
          key={i}
          className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 text-[12px] text-muted-foreground"
        >
          {String(v ?? "")}
        </span>
      ))}
    </div>
  );
}

// ─── Rollup / count / numeric formula ───────────────────────────────────────

function NumberCell({ field, value }: { field: Field; value: unknown }) {
  if (value == null || value === "") {
    return <Minus className="size-3.5 text-muted-foreground/30" />;
  }

  const n = Number(value);
  if (Number.isNaN(n)) {
    return <span className="text-[13px] tabular-nums">{String(value)}</span>;
  }

  return (
    <span className="block truncate text-[13px] tabular-nums" title={String(value)}>
      {field.options.currency
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: field.options.currency,
          }).format(n)
        : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)}
    </span>
  );
}

// ─── Read-only / computed ───────────────────────────────────────────────────

function ReadOnly({ field, value }: { field: Field; value: unknown }) {
  if (field.options.error) {
    return (
      <span className="text-[13px] text-destructive" title={field.options.error}>
        #ERROR
      </span>
    );
  }

  if (value == null || value === "") {
    return <Minus className="size-3.5 text-muted-foreground/30" />;
  }

  // autoNumber stores the bare integer; the prefix and zero-padding are applied
  // here, on the way to the screen, never on disk.
  if (field.type === "autoNumber") {
    return (
      <span className="block truncate text-[13px] tabular-nums text-muted-foreground">
        {formatAutoNumber(value, field.options)}
      </span>
    );
  }

  // createdTime/modifiedTime arrive as the raw timestamptz the database stamped
  // ("2026-07-16T17:02:44.282397+00:00"). Rendering that verbatim is technically a
  // value and practically unreadable, so format it the way the writable date cells
  // already do.
  if (field.type === "createdTime" || field.type === "modifiedTime") {
    const d = new Date(str(value));
    if (!Number.isNaN(d.getTime())) {
      return (
        <span
          className="block truncate text-[13px] tabular-nums text-muted-foreground"
          title={d.toISOString()}
        >
          {d.toLocaleString()}
        </span>
      );
    }
  }

  return (
    <span className="block truncate text-[13px] tabular-nums text-muted-foreground">
      {str(value)}
    </span>
  );
}
