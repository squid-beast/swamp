"use client";
import { Check, ChevronDown } from "lucide-react";
import { FieldMeta } from "@/features/datasets/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

// Editable status / single-select cell. The value is colored text (no filled
// background); click it to pick another option. The change persists.

const colorOf = (options: FieldMeta["options"], value: string) => {
  const opt = options?.find((o) => o.value === value);
  return opt ? `var(--c-${opt.color}-fg)` : "hsl(var(--muted-foreground))";
};

export function SelectCell({
  field,
  value,
  onChange,
}: {
  field: FieldMeta;
  value: unknown;
  onChange: (value: string) => void;
}) {
  const s = value === null || value === undefined ? "" : String(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group/sel inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-[13px] font-semibold outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
          style={{ color: s ? colorOf(field.options, s) : "hsl(var(--muted-foreground))" }}
          aria-label={`Change ${field.displayName}`}
        >
          <span className="truncate">{s || "—"}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/sel:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {(field.options ?? []).map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => o.value !== s && onChange(o.value)}
            className="gap-2 text-[13px] font-semibold"
            style={{ color: `var(--c-${o.color}-fg)` }}
          >
            {o.value}
            {o.value === s && <Check className="ml-auto size-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
