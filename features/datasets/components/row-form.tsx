"use client";

import * as React from "react";
import { FieldMeta, Row } from "@/core/types";
import { validateValue } from "@/core/validate";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Native inputs whose value must be in a canonical format. Money/percent/plain
// numbers use a text input (inputMode decimal) so "$1,234.50" round-trips.
const HTML_INPUT: Partial<Record<FieldMeta["type"], string>> = {
  email: "email",
  url: "url",
  image: "url",
  phone: "tel",
  date: "date",
  datetime: "datetime-local",
  time: "time",
  rating: "number",
  year: "number",
};
const DECIMAL = new Set(["number", "currency", "percent", "duration"]);

const PLACEHOLDER: Partial<Record<FieldMeta["type"], string>> = {
  email: "you@example.com",
  url: "https://…",
  phone: "+1 469-555-1234",
  currency: "1250.50",
  percent: "e.g. 25",
  rating: "0–5",
  year: "2026",
  coordinates: "32.7767, -96.7970",
};

// Seed native date/time pickers with the exact format they require, else blank.
function normalizeForInput(type: FieldMeta["type"], s: string): string {
  if (!s) return "";
  if (type === "date") return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  if (type === "datetime")
    return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) ? `${s.slice(0, 10)}T${s.slice(11, 16)}` : "";
  if (type === "time") {
    const m = /^(\d{1,2}):(\d{2})/.exec(s);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
  }
  return s;
}

// One input, chosen from the field's inferred type (the catalog's UI mapping).
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldMeta;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = field.type;

  if (t === "boolean") {
    const checked = /^(true|yes|y|1)$/i.test(value);
    return (
      <div className="flex items-center gap-2">
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(v ? "true" : "false")} />
        <span className="text-[13px] text-muted-foreground">{checked ? "Yes" : "No"}</span>
      </div>
    );
  }

  if ((t === "singleSelect" || t === "status") && field.options?.length) {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (t === "multiSelect" && field.options?.length) {
    const selected = new Set(value.split(",").map((x) => x.trim()).filter(Boolean));
    const toggle = (opt: string) => {
      const next = new Set(selected);
      next.has(opt) ? next.delete(opt) : next.add(opt);
      onChange([...next].join(", "));
    };
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={cn(
              "rounded-md border px-2 py-1 text-[12px] font-medium transition-colors",
              selected.has(o.value) ? "border-brand bg-brand/10" : "text-muted-foreground hover:bg-muted"
            )}
            style={selected.has(o.value) ? { color: `var(--c-${o.color}-fg)` } : undefined}
          >
            {o.value}
          </button>
        ))}
      </div>
    );
  }

  if (t === "longText" || t === "json") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={t === "json" ? 4 : 3}
        placeholder={t === "json" ? '{ "key": "value" }' : undefined}
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
    );
  }

  if (t === "color") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 rounded border border-input bg-transparent"
          aria-label={`${field.displayName} color`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#00AEEF"
          className="font-mono-data"
        />
      </div>
    );
  }

  const isDateish = t === "date" || t === "datetime" || t === "time";
  return (
    <Input
      type={HTML_INPUT[t] ?? "text"}
      inputMode={DECIMAL.has(t) ? "decimal" : undefined}
      step={t === "rating" ? "0.5" : undefined}
      value={isDateish ? normalizeForInput(t, value) : value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={PLACEHOLDER[t]}
    />
  );
}

export function RowForm({
  open,
  onOpenChange,
  fields,
  mode,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: FieldMeta[];
  mode: "create" | "edit";
  initial?: Row | null;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
}) {
  const editable = React.useMemo(() => fields.filter((f) => !f.hidden), [fields]);
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const seedRef = React.useRef<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    const seed: Record<string, string> = {};
    for (const f of editable) {
      const v = initial?.[f.id];
      seed[f.id] = normalizeForInput(f.type, v == null ? "" : String(v));
    }
    seedRef.current = seed;
    setVals(seed);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (id: string, v: string) => setVals((s) => ({ ...s, [id]: v }));

  const submit = () => {
    const errs: Record<string, string> = {};
    for (const f of editable) {
      const r = validateValue(f, vals[f.id]);
      if (!r.valid) errs[f.id] = r.error ?? "Invalid";
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    // On edit, only write fields the user actually changed (never clobber an
    // untouched value — important for fields whose picker couldn't seed exactly).
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const f of editable) {
      let v = (vals[f.id] ?? "").trim();
      if (f.type === "boolean" && v === "") v = "false";
      if (mode === "edit" && v === (seedRef.current[f.id] ?? "")) continue;
      changed = true;
      out[f.id] = v === "" ? null : v;
    }
    if (mode === "edit" && !changed) {
      onOpenChange(false);
      return;
    }
    onSubmit(out);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4">
          <SheetTitle>{mode === "create" ? "New row" : "Edit row"}</SheetTitle>
          <SheetDescription>Each value is checked against its column&rsquo;s type.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            {editable.map((f) => (
              <div key={f.id} className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5 text-[12.5px]">
                  {f.displayName}
                  <span className="font-mono-data text-[9.5px] uppercase text-muted-foreground/70">
                    {f.type}
                  </span>
                </Label>
                <FieldInput field={f} value={vals[f.id] ?? ""} onChange={(v) => set(f.id, v)} />
                {errors[f.id] && (
                  <span className="text-[11.5px] text-destructive">{errors[f.id]}</span>
                )}
              </div>
            ))}
            {editable.length === 0 && (
              <p className="text-sm text-muted-foreground">This dataset has no editable columns.</p>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>{mode === "create" ? "Add row" : "Save"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
