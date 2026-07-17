"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import { validateValue } from "../validate";
import type { SharedField, SharedMeta } from "../sharing";

// ════════════════════════════════════════════════════════════════════════════
// The public form.
//
// ── The two things that separate a form builder from a toy ──
//
// 1. CONDITIONAL VISIBILITY. "Only ask for a company name if they said they're a
//    business." A form that can't branch is a form that asks everyone everything.
//
// 2. LIMITED OPTIONS. The Status field has eight values internally; the public
//    form should offer two. A form that dumps your whole internal enum on a
//    stranger is a form you can't share.
//
// Skipping these is the most common way a form builder ends up unused.
// ════════════════════════════════════════════════════════════════════════════

export function FormRuntime({
  shareId,
  meta,
  password,
}: {
  shareId: string;
  meta: SharedMeta;
  password?: string;
}) {
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const config = meta.view.config as {
    heading?: string;
    subheading?: string;
    successMsg?: string;
    submitAnother?: boolean;
  };

  // Computed fields have nothing to fill in.
  //
  // `user` is excluded for a different reason: this form is filled by a stranger.
  // The picker needs the base's roster, and the roster is deliberately not public
  // (/api/bases/[id]/members requires auth), so the control could only ever render
  // empty — and whatever a stranger typed would be an unvalidated uuid landing in a
  // column that means "a person here is responsible". The server drops it too; see
  // swamp_share_submit. NocoDB does show User on a form, and this is a considered
  // difference, not an oversight.
  const fields = meta.fields.filter(
    (f) =>
      !["link", "lookup", "rollup", "formula", "count", "button", "barcode", "qr",
        "user",
        "createdTime", "modifiedTime", "createdBy", "modifiedBy"].includes(f.type)
  );

  /** A field is shown unless its condition says otherwise. */
  const isVisible = (f: SharedField): boolean => {
    const when = f.formConfig?.visibleWhen;
    if (!when) return true;

    const source = meta.fields.find((x) => x.id === when.fieldId);
    if (!source) return true;

    return String(values[source.key] ?? "") === when.equals;
  };

  const visible = fields.filter(isVisible);

  const submit = async () => {
    if (submitting) return;

    // Validate only what's VISIBLE. A required field hidden by a condition is not
    // required — otherwise the form is unsubmittable and the user has no idea why,
    // because the field they're failing on isn't on screen.
    const next: Record<string, string> = {};

    for (const f of visible) {
      const value = values[f.key];
      const empty = value == null || value === "" || (Array.isArray(value) && !value.length);

      if (f.formConfig?.required && empty) {
        next[f.key] = "This is required";
        continue;
      }
      if (empty) continue;

      const result = validateValue(
        { type: f.type, options: f.options.options, currency: f.options.currency },
        value
      );
      if (!result.valid) next[f.key] = result.error ?? "Invalid";
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);

    // Only send what's visible. A value typed into a field that a later answer hid
    // must not be submitted — the user retracted it.
    const payload: Record<string, unknown> = {};
    for (const f of visible) {
      if (values[f.key] !== undefined) payload[f.key] = values[f.key];
    }

    const res = await fetch(`/api/s/${shareId}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(password ? { "x-swamp-share-password": password } : {}),
      },
      body: JSON.stringify({ values: payload }),
    });

    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Could not submit");
      return;
    }

    setDone(true);
  };

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
        <CheckCircle2 className="size-8 text-brand" />
        <p className="text-[15px] font-medium">
          {config.successMsg || "Thanks — your response was recorded."}
        </p>

        {config.submitAnother && (
          <Button
            variant="outline"
            onClick={() => {
              setValues({});
              setErrors({});
              setDone(false);
            }}
          >
            Submit another response
          </Button>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg p-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">
        {config.heading || meta.table.name}
      </h1>
      {config.subheading && (
        <p className="mt-1 text-[14px] text-muted-foreground">{config.subheading}</p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {visible.map((f) => (
          <FormField
            key={f.id}
            field={f}
            value={values[f.key]}
            error={errors[f.key]}
            onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
          />
        ))}
      </div>

      <Button onClick={submit} disabled={submitting} className="mt-6 w-full gap-2">
        {submitting && <Loader2 className="size-3.5 animate-spin" />}
        {submitting ? "Submitting…" : "Submit"}
      </Button>
    </main>
  );
}

function FormField({
  field,
  value,
  error,
  onChange,
}: {
  field: SharedField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const cfg = field.formConfig ?? {};
  const label = cfg.label || field.name;

  // The owner may offer a SUBSET of the field's real options. The Status field has
  // eight values internally; the public form shows two.
  const allOptions = field.options.options ?? [];
  const options = cfg.limitedOptions?.length
    ? allOptions.filter((o) => cfg.limitedOptions!.includes(o.value))
    : allOptions;

  const str = value == null ? "" : String(value);

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[13px]">
        {label}
        {cfg.required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>

      {cfg.help && <p className="text-[12px] text-muted-foreground">{cfg.help}</p>}

      {field.type === "boolean" ? (
        <Checkbox checked={value === true} onCheckedChange={(v) => onChange(!!v)} />
      ) : field.type === "longText" || field.type === "json" ? (
        <textarea
          value={str}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "min-h-[6rem] rounded-md border bg-transparent px-2.5 py-2 text-[14px] outline-none focus:border-brand",
            error && "border-destructive"
          )}
        />
      ) : options.length ? (
        <Select value={str} onValueChange={onChange}>
          <SelectTrigger className={cn(error && "border-destructive")}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={
            field.type === "date"
              ? "date"
              : field.type === "datetime"
                ? "datetime-local"
                : field.type === "email"
                  ? "email"
                  : field.type === "url"
                    ? "url"
                    : ["number", "currency", "percent", "rating", "year"].includes(field.type)
                      ? "number"
                      : "text"
          }
          value={str}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && "border-destructive")}
        />
      )}

      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
