"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import { FUNCTIONS } from "../formula/functions";
import { FormulaError, parseFormula } from "../formula/parser";
import type { Field, FieldType, Table } from "../types";

// The relational half of the field editor: link, lookup, rollup, count, formula.
//
// Kept out of FieldDialog because these need things a scalar field doesn't — the
// other tables in the base, the target table's fields, a live formula parser —
// and folding them in would make one component that does everything badly.

export type RelationalType = "link" | "lookup" | "rollup" | "count" | "formula";

export function RelationalFieldForm({
  tableId,
  fields,
  tables,
  type,
  name,
  field,
  onSaved,
  onCancel,
}: {
  tableId: string;
  fields: Field[];
  tables: Table[];
  type: RelationalType;
  name: string;
  field?: Field;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = React.useState(false);

  // link
  const [targetTableId, setTargetTableId] = React.useState(
    field?.options.targetTableId ?? tables[0]?.id ?? ""
  );
  const [cardinality, setCardinality] = React.useState<"one" | "many">(
    field?.options.cardinality ?? "many"
  );

  // lookup / rollup / count
  const linkFields = fields.filter((f) => f.type === "link");
  const [linkFieldId, setLinkFieldId] = React.useState(
    field?.options.linkFieldId ?? linkFields[0]?.id ?? ""
  );
  const [targetFieldId, setTargetFieldId] = React.useState(
    field?.options.targetFieldId ?? ""
  );
  const [fn, setFn] = React.useState<"count" | "sum" | "avg" | "min" | "max">(
    (field?.options.fn as "sum") ?? "sum"
  );
  const [targetFields, setTargetFields] = React.useState<Field[]>([]);

  // formula
  const [expr, setExpr] = React.useState(field?.options.exprRaw ?? "");

  // The fields on the far side of the chosen link. A lookup or rollup needs to
  // know what it can reach.
  const chosenLink = linkFields.find((f) => f.id === linkFieldId);
  React.useEffect(() => {
    const target = chosenLink?.options.targetTableId;
    if (!target) return;

    void (async () => {
      const res = await fetch(`/api/tables/${target}/meta`);
      if (!res.ok) return;
      const body = await res.json();
      setTargetFields(body.fields as Field[]);
    })();
  }, [chosenLink]);

  // Parse on every keystroke. The user should learn a formula is wrong while
  // they're typing it, not after they save and the column renders blank forever.
  const formulaError = React.useMemo(() => {
    if (type !== "formula" || !expr.trim()) return null;
    try {
      parseFormula(expr, {
        fieldsByName: new Map(fields.map((f) => [f.name.toLowerCase(), f.id])),
      });
      return null;
    } catch (e) {
      return e instanceof FormulaError ? e.message : "Invalid formula";
    }
  }, [type, expr, fields]);

  const save = async () => {
    if (saving) return;
    setSaving(true);

    const body: Record<string, unknown> = { type, name };

    if (type === "link") Object.assign(body, { targetTableId, cardinality });
    if (type === "count") Object.assign(body, { linkFieldId });
    if (type === "lookup") Object.assign(body, { linkFieldId, targetFieldId });
    if (type === "rollup") Object.assign(body, { linkFieldId, targetFieldId, fn });
    if (type === "formula") Object.assign(body, { expr, fieldId: field?.id });

    const res = await fetch(`/api/tables/${tableId}/fields/relational`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error ?? "Could not save the field");
      return;
    }

    onSaved();
  };

  const otherTables = tables.filter((t) => t.id !== tableId);
  const canSave =
    !!name.trim() &&
    !formulaError &&
    (type === "link"
      ? !!targetTableId
      : type === "formula"
        ? !!expr.trim()
        : type === "count"
          ? !!linkFieldId
          : !!linkFieldId && !!targetFieldId);

  return (
    <div className="flex flex-col gap-3">
      {/* ── LINK ── */}
      {type === "link" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">Links to table</Label>
            <Select value={targetTableId} onValueChange={setTargetTableId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a table" />
              </SelectTrigger>
              <SelectContent>
                {/* Self-links are excluded. They're legitimate ("Task → parent
                    Task") but the symmetric-mirror logic has an extra case, and
                    shipping the simple thing first beats shipping a subtle bug. */}
                {otherTables.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {otherTables.length === 0 && (
              <p className="text-[12px] text-muted-foreground">
                There&apos;s nothing to link to yet — this base only has one table.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">How many</Label>
            <Select
              value={cardinality}
              onValueChange={(v) => setCardinality(v as "one" | "many")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="many">Link to many records</SelectItem>
                <SelectItem value="one">Link to a single record</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="rounded-md bg-muted/50 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground">
            A matching field is created on the other table too — a link is one edge
            seen from both ends, and the two can never disagree.
          </p>
        </>
      )}

      {/* ── LOOKUP / ROLLUP / COUNT ── */}
      {type !== "link" && type !== "formula" && (
        <>
          {linkFields.length === 0 ? (
            <p className="rounded-md bg-muted/50 px-2.5 py-2 text-[12px] text-muted-foreground">
              This table has no link fields yet. Add a link first — a{" "}
              {type} reaches across one.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[12px] text-muted-foreground">Through link</Label>
                <Select value={linkFieldId} onValueChange={setLinkFieldId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {linkFields.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {type !== "count" && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] text-muted-foreground">
                    {type === "rollup" ? "Aggregate which field" : "Pull which field"}
                  </Label>
                  <Select value={targetFieldId} onValueChange={setTargetFieldId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a field" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {targetFields.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {type === "rollup" && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] text-muted-foreground">How</Label>
                  <Select value={fn} onValueChange={(v) => setFn(v as "sum")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sum">Sum</SelectItem>
                      <SelectItem value="avg">Average</SelectItem>
                      <SelectItem value="min">Minimum</SelectItem>
                      <SelectItem value="max">Maximum</SelectItem>
                      <SelectItem value="count">Count</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── FORMULA ── */}
      {type === "formula" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">Formula</Label>
            <textarea
              autoFocus
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="{Price} * {Quantity}"
              spellCheck={false}
              className={cn(
                "min-h-[5rem] w-full rounded-md border bg-transparent px-2.5 py-2 font-mono text-[13px] outline-none",
                formulaError ? "border-destructive" : "focus:border-brand"
              )}
            />

            {formulaError ? (
              <p className="flex items-start gap-1.5 text-[12px] text-destructive">
                <AlertCircle className="mt-0.5 size-3 shrink-0" />
                {formulaError}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Reference fields with braces: <code>{"{Amount}"}</code>. Renaming a
                field won&apos;t break this — formulas remember fields by identity,
                not by name.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">Fields</Label>
            <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
              {fields
                .filter((f) => f.id !== field?.id)
                .map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setExpr((e) => `${e}{${f.name}}`)}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted/70"
                  >
                    {f.name}
                  </button>
                ))}
            </div>
          </div>

          <details className="rounded-md border px-2.5 py-2">
            <summary className="cursor-pointer text-[12px] text-muted-foreground">
              Functions ({FUNCTIONS.length})
            </summary>
            <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto">
              {FUNCTIONS.map((f) => (
                <button
                  key={f.name}
                  onClick={() => setExpr((e) => `${e}${f.name}(`)}
                  className="rounded px-1 py-0.5 text-left hover:bg-muted"
                >
                  <code className="text-[11px] font-medium">{f.signature}</code>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {f.description}
                  </span>
                </button>
              ))}
            </div>
          </details>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!canSave || saving}>
          {saving ? "Saving…" : field ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  );
}

/** The relational types, for the type picker in FieldDialog. */
export const RELATIONAL_TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: "link", label: "Link to another record", hint: "Point at records in another table" },
  { value: "lookup", label: "Lookup", hint: "Pull a field across a link" },
  { value: "rollup", label: "Rollup", hint: "Sum, average or count across a link" },
  { value: "count", label: "Count", hint: "How many linked records" },
  { value: "formula", label: "Formula", hint: "Compute from this record's fields" },
];
