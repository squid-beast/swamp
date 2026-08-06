"use client";

import * as React from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import {
  isFilterGroup,
  isNumericField,
  isTemporalField,
  operatorLabel,
  operatorsFor,
  type Field,
  type FilterLeaf,
  type FilterNode,
  type FilterOp,
} from "../types";

// ════════════════════════════════════════════════════════════════════════════
// The filter builder.
//
// The engine has been able to compile arbitrarily nested and/or/not trees with
// per-type operators and relative date windows since Phase 1b. Until now there
// was no way to build one. This is that.
//
// ── Three things it gets right that are easy to get wrong ──
//
// 1. SIBLINGS SHARE ONE OPERATOR. Row 1 reads "Where". Row 2 has the and/or
//    dropdown. Rows 3+ MIRROR row 2 as static text. Letting every row pick its
//    own connective produces `A and B or C`, which is ambiguous, and then you
//    spend a week writing "detect mixed operators and normalize" cleanup code.
//
// 2. OPERATORS ARE GATED BY TYPE, and their LABELS ARE CONTEXTUAL. `>` on a
//    number is "is after" on a date. Offering `checked` on a text field, or `>`
//    on a checkbox, is how a filter builder ends up feeling like a debug tool.
//
// 3. DATE FILTERS GET A SECOND DROPDOWN. "Due date — is within — the next 7 days"
//    is stored as a RELATIVE window and re-evaluated on every query. It is still
//    true tomorrow. That is the single feature that makes filters feel alive, and
//    a builder that only offers a date picker cannot express it at all.
// ════════════════════════════════════════════════════════════════════════════

/** Operators that take no value: the value input disappears entirely. */
const NULLARY: FilterOp[] = ["empty", "notempty", "checked", "notchecked"];

/** Sub-operators offered for a date field, by operator. */
const POINT_SUB_OPS = [
  "today",
  "tomorrow",
  "yesterday",
  "oneWeekAgo",
  "oneWeekFromNow",
  "oneMonthAgo",
  "oneMonthFromNow",
  "daysAgo",
  "daysFromNow",
  "exactDate",
] as const;

const WITHIN_SUB_OPS = [
  "pastWeek",
  "pastMonth",
  "pastYear",
  "nextWeek",
  "nextMonth",
  "nextYear",
  "pastNumberOfDays",
  "nextNumberOfDays",
] as const;

const SUB_OP_LABEL: Record<string, string> = {
  today: "today",
  tomorrow: "tomorrow",
  yesterday: "yesterday",
  oneWeekAgo: "one week ago",
  oneWeekFromNow: "one week from now",
  oneMonthAgo: "one month ago",
  oneMonthFromNow: "one month from now",
  daysAgo: "number of days ago",
  daysFromNow: "number of days from now",
  exactDate: "exact date",
  pastWeek: "the past week",
  pastMonth: "the past month",
  pastYear: "the past year",
  nextWeek: "the next week",
  nextMonth: "the next month",
  nextYear: "the next year",
  pastNumberOfDays: "the past N days",
  nextNumberOfDays: "the next N days",
};

/** Sub-ops that need a number alongside them. */
const NEEDS_N = new Set(["daysAgo", "daysFromNow", "pastNumberOfDays", "nextNumberOfDays"]);

const emptyLeaf = (fields: Field[]): FilterLeaf => {
  const field = fields[0];
  return { field: field.key, op: operatorsFor(field.type)[0] };
};

export function FilterBuilder({
  fields,
  value,
  onChange,
}: {
  fields: Field[];
  value: FilterNode | null;
  onChange: (next: FilterNode | null) => void;
}) {
  // The tree is normalised to a single root GROUP so the UI only ever has to
  // render one shape. A bare leaf at the root would need its own code path for
  // "add a second condition", and that path is where bugs live.
  const root: FilterNode =
    value && isFilterGroup(value) ? value : value ? { op: "and", children: [value] } : { op: "and", children: [] };

  const setRoot = (next: FilterNode) => {
    const group = next as { op: "and" | "or" | "not"; children: FilterNode[] };
    onChange(group.children.length ? next : null);
  };

  return (
    <div className="w-[min(44rem,92vw)] p-3">
      <GroupEditor
        fields={fields}
        node={root}
        onChange={setRoot}
        depth={0}
        isRoot
      />
    </div>
  );
}

function GroupEditor({
  fields,
  node,
  onChange,
  onRemove,
  depth,
  isRoot = false,
}: {
  fields: Field[];
  node: FilterNode;
  onChange: (next: FilterNode) => void;
  onRemove?: () => void;
  depth: number;
  isRoot?: boolean;
}) {
  if (!isFilterGroup(node)) return null;

  const setChild = (i: number, child: FilterNode) => {
    const children = [...node.children];
    children[i] = child;
    onChange({ ...node, children });
  };

  const removeChild = (i: number) => {
    onChange({ ...node, children: node.children.filter((_, j) => j !== i) });
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        !isRoot && "rounded-md border border-dashed bg-muted/30 p-2"
      )}
    >
      {node.children.length === 0 && (
        <p className="px-1 py-2 text-[13px] text-muted-foreground">
          No conditions. Everything shows.
        </p>
      )}

      {node.children.map((child, i) => (
        <div key={i} className="flex items-start gap-1.5">
          {/* The connective column. Row 0 says "Where". Row 1 owns the dropdown.
              Rows 2+ mirror it as static text — siblings share ONE operator. */}
          <div className="w-[68px] shrink-0 pt-1">
            {i === 0 ? (
              <span className="px-1 text-[13px] text-muted-foreground">Where</span>
            ) : i === 1 ? (
              <Select
                value={node.op}
                onValueChange={(op) =>
                  onChange({ ...node, op: op as "and" | "or" | "not" })
                }
              >
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">and</SelectItem>
                  <SelectItem value="or">or</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="px-1 text-[13px] text-muted-foreground">{node.op}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {isFilterGroup(child) ? (
              <GroupEditor
                fields={fields}
                node={child}
                onChange={(next) => setChild(i, next)}
                onRemove={() => removeChild(i)}
                depth={depth + 1}
              />
            ) : (
              <LeafEditor
                fields={fields}
                leaf={child}
                onChange={(next) => setChild(i, next)}
                onRemove={() => removeChild(i)}
              />
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-1 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[13px]"
          disabled={!fields.length}
          onClick={() =>
            onChange({ ...node, children: [...node.children, emptyLeaf(fields)] })
          }
        >
          <Plus className="size-3.5" />
          Add condition
        </Button>

        {/* The compiler caps nesting at 10. Stopping the UI a level short means a
            user can never build a tree the engine will refuse. */}
        {depth < 8 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-[13px]"
            disabled={!fields.length}
            onClick={() =>
              onChange({
                ...node,
                children: [
                  ...node.children,
                  { op: "and", children: [emptyLeaf(fields)] },
                ],
              })
            }
          >
            <Plus className="size-3.5" />
            Add group
          </Button>
        )}

        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-muted-foreground"
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function LeafEditor({
  fields,
  leaf,
  onChange,
  onRemove,
}: {
  fields: Field[];
  leaf: FilterLeaf;
  onChange: (next: FilterLeaf) => void;
  onRemove: () => void;
}) {
  const field = fields.find((f) => f.key === leaf.field) ?? fields[0];

  // A filter on a field that was deleted. Say so, rather than rendering a control
  // bound to nothing.
  if (!field) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 px-2 py-1.5">
        <span className="text-[13px] text-destructive">Field no longer exists</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    );
  }

  const ops = operatorsFor(field.type);
  const temporal = isTemporalField(field.type);
  const nullary = NULLARY.includes(leaf.op);

  // Field-to-field comparison — "Actual > Forecast". Offered on the comparison
  // operators for numeric/temporal fields, restricted to the same type family
  // (the compiler coerces the rhs into the LEFT field's family; a text rhs on a
  // numeric left would just be NULL, so don't offer it).
  const comparisonOps = new Set<FilterOp>(["eq", "neq", "gt", "gte", "lt", "lte"]);
  const numeric = isNumericField(field.type);
  const sameFamily =
    comparisonOps.has(leaf.op) && (numeric || temporal)
      ? fields.filter(
          (f) =>
            f.key !== field.key &&
            (numeric ? isNumericField(f.type) : isTemporalField(f.type))
        )
      : [];
  const byField = !!leaf.valueField;

  const subOps = leaf.op === "isWithin" ? WITHIN_SUB_OPS : POINT_SUB_OPS;
  const showSubOp = temporal && !nullary && !byField;
  const showN = showSubOp && leaf.subOp && NEEDS_N.has(leaf.subOp);
  const showValue =
    !nullary && !byField && (!temporal || leaf.subOp === "exactDate" || !showSubOp);

  const changeField = (key: string) => {
    const next = fields.find((f) => f.key === key)!;
    const nextOps = operatorsFor(next.type);

    // Changing the field can invalidate the operator (you cannot be ">" on a
    // checkbox). Keep it if it still applies, otherwise fall back to the first
    // valid one — and drop the sub-op, which is meaningless off a date.
    onChange({
      field: key,
      op: nextOps.includes(leaf.op) ? leaf.op : nextOps[0],
      ...(isTemporalField(next.type) ? {} : {}),
    });
  };

  const changeOp = (op: FilterOp) => {
    const next: FilterLeaf = { field: leaf.field, op };

    if (isTemporalField(field.type)) {
      // Sensible defaults, so the control is never in a half-configured state:
      // isWithin needs a range sub-op, everything else a point one.
      next.subOp = op === "isWithin" ? "pastNumberOfDays" : "exactDate";
      if (op === "isWithin") next.n = 7;
    } else if (!NULLARY.includes(op)) {
      next.value = leaf.value;
    }

    onChange(next);
  };

  const selectOptions = field.options.options ?? [];

  return (
    // flex-wrap: a temporal filter (field + operator + sub-op + N + value + remove)
    // is wider than the popover, so the controls flow to a second line instead of
    // overflowing and clipping.
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={field.key} onValueChange={changeField}>
        <SelectTrigger className="h-8 w-[9rem] shrink-0 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={leaf.op} onValueChange={(v) => changeOp(v as FilterOp)}>
        <SelectTrigger className="h-8 w-[9.5rem] shrink-0 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {operatorLabel(op, field.type)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {sameFamily.length > 0 && (
        <Select
          value={leaf.valueField ?? "__value"}
          onValueChange={(v) => {
            if (v === "__value") {
              const { valueField: _drop, ...rest } = leaf;
              onChange(rest);
            } else {
              // A field rhs replaces the literal AND the date sub-op machinery.
              onChange({ field: leaf.field, op: leaf.op, valueField: v });
            }
          }}
        >
          <SelectTrigger className="h-8 w-[8rem] shrink-0 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="__value">a value</SelectItem>
            {sameFamily.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showSubOp && (
        <Select
          value={leaf.subOp ?? "exactDate"}
          onValueChange={(v) =>
            onChange({
              ...leaf,
              subOp: v as FilterLeaf["subOp"],
              ...(NEEDS_N.has(v) ? { n: leaf.n ?? 7 } : { n: undefined }),
            })
          }
        >
          <SelectTrigger className="h-8 min-w-[9rem] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {subOps.map((s) => (
              <SelectItem key={s} value={s}>
                {SUB_OP_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showN && (
        <Input
          type="number"
          min={1}
          value={leaf.n ?? 7}
          onChange={(e) => onChange({ ...leaf, n: Number(e.target.value) || 1 })}
          className="h-8 w-16 text-[13px]"
        />
      )}

      {showValue &&
        (selectOptions.length ? (
          <Select
            value={String(leaf.value ?? "")}
            onValueChange={(v) => onChange({ ...leaf, value: v })}
          >
            <SelectTrigger className="h-8 min-w-[8rem] text-[13px]">
              <SelectValue placeholder="Value" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {selectOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={
              field.type === "date" || field.type === "datetime"
                ? "date"
                : ["number", "currency", "percent", "rating", "year"].includes(field.type)
                  ? "number"
                  : "text"
            }
            value={String(leaf.value ?? "")}
            onChange={(e) => onChange({ ...leaf, value: e.target.value })}
            placeholder="Value"
            className="h-8 min-w-[8rem] text-[13px]"
          />
        ))}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-8 shrink-0 text-muted-foreground"
        onClick={onRemove}
        aria-label="Remove condition"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
