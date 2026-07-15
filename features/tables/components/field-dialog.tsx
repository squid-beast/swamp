"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { cn } from "@/shared/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  SCALAR_FIELD_TYPES,
  isComputedField,
  type Field,
  type FieldType,
  type SelectOption,
  type Table,
} from "../types";
import {
  RELATIONAL_TYPES,
  RelationalFieldForm,
  type RelationalType,
} from "./relational-fields";
import { FormulaError, parseFormula } from "../formula/parser";

// ════════════════════════════════════════════════════════════════════════════
// Add or edit a field.
//
// This did not exist. Inference guessed a column's type on import and that guess
// was FINAL — a phone number read as a number (leading zeros gone forever), a
// status column read as free text, and no way to fix either. You could rename a
// field and hide it. That was the whole schema surface.
//
// ── Retyping is safe, and worth saying out loud ──
//
// Changing a field's type does NOT touch the stored values. A `text` column
// holding "1000" becomes a `currency` column holding "1000"; the query engine
// coerces at read time, and coerces safely — "N/A" becomes null rather than
// throwing and taking the whole query with it.
//
// So retyping is reversible. Get it wrong, change it back, nothing is lost. That
// is a much better story than a destructive migration, and it falls out of the
// JSONB storage decision for free.
// ════════════════════════════════════════════════════════════════════════════

const TYPE_LABEL: Partial<Record<FieldType, string>> = {
  text: "Single line text",
  longText: "Long text",
  number: "Number",
  currency: "Currency",
  percent: "Percent",
  rating: "Rating",
  boolean: "Checkbox",
  date: "Date",
  datetime: "Date & time",
  time: "Time",
  duration: "Duration",
  year: "Year",
  email: "Email",
  phone: "Phone",
  url: "URL",
  image: "Image URL",
  color: "Colour",
  uuid: "UUID",
  coordinates: "Coordinates",
  singleSelect: "Single select",
  multiSelect: "Multiple select",
  status: "Status",
  json: "JSON",
};

const HAS_OPTIONS = new Set<FieldType>(["singleSelect", "multiSelect", "status"]);

/** Not scalars, not relational. They have a value AND a behaviour. */
const PLATFORM_TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: "attachment", label: "Attachment", hint: "Files, stored privately" },
  { value: "button", label: "Button", hint: "Open a URL, or call a webhook" },
];

const PALETTE = ["amber", "violet", "teal", "rose", "sky", "lime", "orange", "fuchsia"];

export function FieldDialog({
  open,
  onOpenChange,
  tableId,
  fields,
  tables,
  field,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId: string;
  /** All fields on this table — a formula or rollup needs to see them. */
  fields: Field[];
  /** All tables in this base — a link needs somewhere to point. */
  tables: Table[];
  /** Undefined = creating a new field. */
  field?: Field;
  onSaved: () => void;
}) {
  const editing = !!field;

  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<FieldType>("text");
  const [options, setOptions] = React.useState<SelectOption[]>([]);
  const [currency, setCurrency] = React.useState("USD");
  const [saving, setSaving] = React.useState(false);

  // button
  const [action, setAction] = React.useState<"url" | "webhook">("url");
  const [label, setLabel] = React.useState("");
  const [expr, setExpr] = React.useState("");
  const [webhookId, setWebhookId] = React.useState("");
  const [webhooks, setWebhooks] = React.useState<{ id: string; name: string }[]>([]);

  const baseId = fields[0]?.baseId;

  React.useEffect(() => {
    if (!open) return;
    setName(field?.name ?? "");
    setType(field?.type ?? "text");
    setOptions(field?.options.options ?? []);
    setCurrency(field?.options.currency ?? "USD");

    setAction(field?.options.action ?? "url");
    setLabel(field?.options.label ?? "");
    setExpr(field?.options.exprRaw ?? "");
    setWebhookId(field?.options.webhookId ?? "");
  }, [open, field]);

  // A webhook button needs a webhook to point at. Load them lazily — most fields
  // are not buttons and this is a request nobody else needs to pay for.
  React.useEffect(() => {
    if (!open || type !== "button" || action !== "webhook" || !baseId) return;

    void fetch(`/api/bases/${baseId}/webhooks`)
      .then((r) => (r.ok ? r.json() : { webhooks: [] }))
      .then((b) => setWebhooks(b.webhooks ?? []));
  }, [open, type, action, baseId]);

  // A URL button IS a formula — an expression over the record's other fields,
  // compiled to SQL exactly like one. So it is parsed with the same parser, on
  // every keystroke, and the AST (which references fields by ID) is what's stored.
  // Rename a field afterwards and the button doesn't notice.
  const buttonFormulaError = React.useMemo(() => {
    if (type !== "button" || action !== "url" || !expr.trim()) return null;
    try {
      parseFormula(expr, {
        fieldsByName: new Map(fields.map((f) => [f.name.toLowerCase(), f.id])),
      });
      return null;
    } catch (e) {
      return e instanceof FormulaError ? e.message : "Invalid formula";
    }
  }, [type, action, expr, fields]);

  const buttonOptions = () => {
    if (type !== "button") return {};

    const shared = { action, label: label.trim() || name.trim() };

    if (action === "webhook") return { ...shared, webhookId };

    const ast = expr.trim()
      ? parseFormula(expr, {
          fieldsByName: new Map(fields.map((f) => [f.name.toLowerCase(), f.id])),
        })
      : undefined;

    return { ...shared, ast, exprRaw: expr };
  };

  const save = async () => {
    if (!name.trim() || saving || buttonFormulaError) return;
    setSaving(true);

    const payload = {
      name: name.trim(),
      type,
      options: {
        ...(HAS_OPTIONS.has(type) ? { options } : {}),
        ...(type === "currency" ? { currency } : {}),
        ...buttonOptions(),
      },
    };

    const res = await fetch(
      editing ? `/api/fields/${field!.id}` : `/api/tables/${tableId}/fields`,
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // A 403 here means RLS said no: changing schema needs CREATOR, and editors
      // don't have it. Say that, rather than "request failed".
      toast.error(
        res.status === 403
          ? "You need permission to change this table's schema."
          : (body?.error ?? "Could not save the field")
      );
      return;
    }

    onOpenChange(false);
    onSaved();
  };

  const remove = async () => {
    if (!field || saving) return;
    setSaving(true);

    const res = await fetch(`/api/fields/${field.id}`, { method: "DELETE" });
    setSaving(false);

    if (!res.ok) {
      toast.error("Could not delete the field");
      return;
    }

    // Soft delete: the values stay in each record's `data`, just undescribed. An
    // accidental delete is recoverable — say so, because "deleted" reads as final.
    toast.success("Field removed. The data is still there if you re-add it.");
    onOpenChange(false);
    onSaved();
  };

  const relational = isComputedField(type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit field" : "New field"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changing the type doesn't touch your data — it changes how it's read. You can change it back."
              : "Name it and pick a type."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-name" className="text-[12px] text-muted-foreground">
              Name
            </Label>
            <Input
              id="field-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => !relational && e.key === "Enter" && save()}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as FieldType)}
              // Retyping a link into a text field would orphan every edge in the
              // `links` table. Changing type is free for scalars precisely because
              // their data lives in `data`; a relational field's data doesn't.
              disabled={editing && isComputedField(field!.type)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {SCALAR_FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t] ?? t}
                  </SelectItem>
                ))}

                <div className="my-1 border-t" />

                {RELATIONAL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex flex-col items-start">
                      <span>{t.label}</span>
                      <span className="text-[11px] text-muted-foreground">{t.hint}</span>
                    </span>
                  </SelectItem>
                ))}

                <div className="my-1 border-t" />

                {PLATFORM_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex flex-col items-start">
                      <span>{t.label}</span>
                      <span className="text-[11px] text-muted-foreground">{t.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === "button" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[12px] text-muted-foreground">What it does</Label>
                <Select
                  value={action}
                  onValueChange={(v) => setAction(v as "url" | "webhook")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="url">
                      <span className="flex flex-col items-start">
                        <span>Open a URL</span>
                        <span className="text-[11px] text-muted-foreground">
                          Built per record, from a formula
                        </span>
                      </span>
                    </SelectItem>
                    <SelectItem value="webhook">
                      <span className="flex flex-col items-start">
                        <span>Call a webhook</span>
                        <span className="text-[11px] text-muted-foreground">
                          Sent from our server, signed
                        </span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-[12px] text-muted-foreground">
                  Button label (optional)
                </Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={name || "Open"}
                />
              </div>

              {action === "url" ? (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] text-muted-foreground">URL formula</Label>
                  <Input
                    value={expr}
                    onChange={(e) => setExpr(e.target.value)}
                    placeholder={`CONCAT("https://crm.example.com/c/", {Id})`}
                    className={cn("font-mono text-[13px]", buttonFormulaError && "border-destructive")}
                  />
                  <p
                    className={cn(
                      "text-[11px] leading-relaxed",
                      buttonFormulaError ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {buttonFormulaError ??
                      "Reference fields with {Name}. It compiles to SQL, so you can filter and sort by the URL like any other column."}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] text-muted-foreground">Webhook</Label>
                  <Select value={webhookId} onValueChange={setWebhookId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a webhook" />
                    </SelectTrigger>
                    <SelectContent>
                      {webhooks.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {webhooks.length
                      ? "Only editors can press it. The URL and the secret never reach the browser."
                      : "No webhooks yet — create one under Automations first."}
                  </p>
                </div>
              )}
            </div>
          )}

          {relational && (
            <RelationalFieldForm
              tableId={tableId}
              fields={fields}
              tables={tables}
              type={type as RelationalType}
              name={name}
              field={editing ? field : undefined}
              onSaved={() => {
                onOpenChange(false);
                onSaved();
              }}
              onCancel={() => onOpenChange(false)}
            />
          )}

          {!relational && type === "currency" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] text-muted-foreground">Currency code</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="USD"
              />
            </div>
          )}

          {!relational && HAS_OPTIONS.has(type) && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] text-muted-foreground">Options</Label>

              <div className="flex max-h-48 flex-col gap-1 overflow-auto">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={o.value}
                      onChange={(e) => {
                        const next = [...options];
                        next[i] = { ...next[i], value: e.target.value };
                        setOptions(next);
                      }}
                      className="h-8 text-[13px]"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-muted-foreground"
                      onClick={() => setOptions(options.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="justify-start gap-1.5 text-[13px]"
                onClick={() =>
                  setOptions([
                    ...options,
                    { value: "", color: PALETTE[options.length % PALETTE.length] },
                  ])
                }
              >
                <Plus className="size-3.5" />
                Add option
              </Button>

              {editing && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Removing an option doesn&apos;t clear it from records that already
                  use it — those cells keep their value and simply stop matching the
                  option list.
                </p>
              )}
            </div>
          )}
        </div>

        {!relational && (
        <DialogFooter className="sm:justify-between">
          {editing && !field?.isPrimary ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={remove}
              disabled={saving}
            >
              Delete field
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!name.trim() || saving}>
              {saving ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
