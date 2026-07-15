"use client";

import * as React from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
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
import { isReadOnlyField, type Field, type View, type ViewField } from "../types";
import type { FormFieldConfig } from "../sharing";

// The form builder — the owner side of a form view.
//
// Per-field: label override, help text, required, CONDITIONAL VISIBILITY, and
// LIMITED OPTIONS. The last two are what separate a form builder from a toy, and
// they're the two people skip:
//
//   • Without conditional visibility, a form asks everyone everything.
//   • Without limited options, the public form dumps your whole internal status
//     enum on a stranger.

export function FormBuilder({
  fields,
  view,
  viewFields,
  onSave,
}: {
  fields: Field[];
  view: View;
  viewFields: ViewField[];
  onSave: (patch: {
    view?: Record<string, unknown>;
    viewFields?: { fieldId: string; show?: boolean; formConfig?: FormFieldConfig }[];
  }) => Promise<void>;
}) {
  const config = view.config as {
    heading?: string;
    subheading?: string;
    successMsg?: string;
    submitAnother?: boolean;
  };

  const [heading, setHeading] = React.useState(config.heading ?? "");
  const [subheading, setSubheading] = React.useState(config.subheading ?? "");
  const [successMsg, setSuccessMsg] = React.useState(config.successMsg ?? "");
  const [submitAnother, setSubmitAnother] = React.useState(!!config.submitAnother);

  // Computed fields can't be filled in. Don't offer them.
  const fillable = fields.filter((f) => !isReadOnlyField(f.type));

  const byField = new Map(viewFields.map((vf) => [vf.fieldId, vf]));

  const cfgOf = (fieldId: string): FormFieldConfig =>
    ((byField.get(fieldId) as unknown as { formConfig?: FormFieldConfig })?.formConfig ??
      {}) as FormFieldConfig;

  const saveHeader = async () => {
    await onSave({
      view: { config: { ...view.config, heading, subheading, successMsg, submitAnother } },
    });
    toast.success("Form saved");
  };

  const patchField = async (fieldId: string, patch: Partial<FormFieldConfig>) => {
    await onSave({
      viewFields: [{ fieldId, formConfig: { ...cfgOf(fieldId), ...patch } }],
    });
  };

  const toggleShown = async (fieldId: string, show: boolean) => {
    await onSave({ viewFields: [{ fieldId, show }] });
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-[13px] font-medium">Form</h2>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">Heading</Label>
            <Input value={heading} onChange={(e) => setHeading(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">Subheading</Label>
            <Input value={subheading} onChange={(e) => setSubheading(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">
              Message after submitting
            </Label>
            <Input
              value={successMsg}
              onChange={(e) => setSuccessMsg(e.target.value)}
              placeholder="Thanks — your response was recorded."
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox
              checked={submitAnother}
              onCheckedChange={(v) => setSubmitAnother(!!v)}
            />
            Offer a “submit another response” button
          </label>

          <Button size="sm" className="self-start" onClick={saveHeader}>
            Save
          </Button>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-medium">Fields</h2>

          {fillable.map((field) => {
            const vf = byField.get(field.id);
            const shown = vf?.show !== false;
            const cfg = cfgOf(field.id);

            return (
              <div
                key={field.id}
                className={cn(
                  "flex flex-col gap-2.5 rounded-lg border p-3",
                  !shown && "opacity-50"
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleShown(field.id, !shown)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={shown ? "Hide from form" : "Show on form"}
                  >
                    {shown ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>

                  <span className="text-[13px] font-medium">{field.name}</span>
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {field.type}
                  </span>

                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px]">
                    <Checkbox
                      checked={!!cfg.required}
                      disabled={!shown}
                      onCheckedChange={(v) => patchField(field.id, { required: !!v })}
                    />
                    Required
                  </label>
                </div>

                {shown && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        defaultValue={cfg.label ?? ""}
                        placeholder={`Label (default: ${field.name})`}
                        onBlur={(e) => patchField(field.id, { label: e.target.value })}
                        className="h-8 text-[13px]"
                      />
                      <Input
                        defaultValue={cfg.help ?? ""}
                        placeholder="Help text"
                        onBlur={(e) => patchField(field.id, { help: e.target.value })}
                        className="h-8 text-[13px]"
                      />
                    </div>

                    {/* Conditional visibility. Only ask for a company name if they
                        said they're a business. */}
                    <div className="flex items-center gap-1.5 text-[12px]">
                      <span className="text-muted-foreground">Show only when</span>

                      <Select
                        value={cfg.visibleWhen?.fieldId ?? "__always"}
                        onValueChange={(v) =>
                          patchField(field.id, {
                            visibleWhen:
                              v === "__always"
                                ? undefined
                                : { fieldId: v, equals: cfg.visibleWhen?.equals ?? "" },
                          })
                        }
                      >
                        <SelectTrigger className="h-7 w-40 text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__always">always shown</SelectItem>
                          {fillable
                            .filter((f) => f.id !== field.id && (f.options.options?.length ?? 0) > 0)
                            .map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      {cfg.visibleWhen && (
                        <>
                          <span className="text-muted-foreground">is</span>
                          <Select
                            value={cfg.visibleWhen.equals || ""}
                            onValueChange={(v) =>
                              patchField(field.id, {
                                visibleWhen: { fieldId: cfg.visibleWhen!.fieldId, equals: v },
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-32 text-[12px]">
                              <SelectValue placeholder="value" />
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                fields.find((f) => f.id === cfg.visibleWhen!.fieldId)?.options
                                  .options ?? []
                              ).map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>

                    {/* Limited options. The Status field has eight values
                        internally; the public form should offer two. */}
                    {(field.options.options?.length ?? 0) > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[12px] text-muted-foreground">
                          Offer which options
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {field.options.options!.map((o) => {
                            const limited = cfg.limitedOptions;
                            const on = !limited?.length || limited.includes(o.value);

                            return (
                              <button
                                key={o.value}
                                onClick={() => {
                                  const all = field.options.options!.map((x) => x.value);
                                  const current = limited?.length ? limited : all;
                                  const next = on
                                    ? current.filter((v) => v !== o.value)
                                    : [...current, o.value];

                                  patchField(field.id, {
                                    // All of them selected means "no restriction" —
                                    // storing the full list would silently break the
                                    // moment someone adds a ninth option.
                                    limitedOptions:
                                      next.length === all.length ? undefined : next,
                                  });
                                }}
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[11px]",
                                  on
                                    ? "bg-brand/15 text-brand"
                                    : "bg-muted text-muted-foreground line-through"
                                )}
                              >
                                {o.value}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
