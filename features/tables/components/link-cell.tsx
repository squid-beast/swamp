"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { cn } from "@/shared/lib/utils";
import type { Field } from "../types";

// The link cell.
//
// A link cell's VALUE is `[{ id, label }]` — the query engine resolves it from the
// `links` table and merges it into `data`, so as far as the grid is concerned a
// link is just another field with an array in it.
//
// The picker searches the TARGET table through the same query engine everything
// else uses. There is no bespoke "search for records to link" endpoint, because
// searching a table is a thing we already do.

export interface LinkValue {
  id: string;
  label: string;
}

export function LinkCell({
  field,
  recordId,
  tableId,
  value,
  onChanged,
}: {
  field: Field;
  recordId: string;
  tableId: string;
  value: unknown;
  onChanged: () => void;
}) {
  const linked: LinkValue[] = Array.isArray(value) ? (value as LinkValue[]) : [];
  const [open, setOpen] = React.useState(false);

  const setLinks = async (ids: string[]) => {
    const res = await fetch(`/api/tables/${tableId}/records/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId: field.id, recordId, linkedIds: ids }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Could not update the link");
      return;
    }
    onChanged();
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {linked.map((l) => (
        <span
          key={l.id}
          className="group/chip inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[12px]"
        >
          <span className="truncate">{l.label || "Untitled"}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void setLinks(linked.filter((x) => x.id !== l.id).map((x) => x.id));
            }}
            className="opacity-0 group-hover/chip:opacity-100"
            aria-label={`Unlink ${l.label}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="rounded p-0.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground"
            aria-label="Link a record"
            data-testid="link-add"
          >
            <Plus className="size-3.5" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72 p-0">
          <RecordPicker
            targetTableId={field.options.targetTableId!}
            selected={linked}
            single={field.options.cardinality === "one"}
            onToggle={(record) => {
              const has = linked.some((l) => l.id === record.id);
              const next = has
                ? linked.filter((l) => l.id !== record.id)
                : field.options.cardinality === "one"
                  ? [record]
                  : [...linked, record];

              void setLinks(next.map((l) => l.id));
              if (field.options.cardinality === "one") setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RecordPicker({
  targetTableId,
  selected,
  single,
  onToggle,
}: {
  targetTableId: string;
  selected: LinkValue[];
  single: boolean;
  onToggle: (record: LinkValue) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [results, setResults] = React.useState<LinkValue[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [primaryKey, setPrimaryKey] = React.useState<string | null>(null);

  // The target table's primary field is what a record calls itself when something
  // else refers to it. Fetch it once; without it every option would read "Untitled".
  React.useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/tables/${targetTableId}/meta`);
      if (!res.ok) return;
      const body = await res.json();
      const primary = (body.fields as { key: string; isPrimary: boolean }[]).find(
        (f) => f.isPrimary
      );
      setPrimaryKey(primary?.key ?? null);
    })();
  }, [targetTableId]);

  React.useEffect(() => {
    if (!primaryKey) return;

    const t = setTimeout(async () => {
      setLoading(true);

      // Searching the target table goes through the SAME query engine as
      // everything else. No bespoke endpoint — searching a table is a thing we
      // already know how to do, and a second implementation would be a second set
      // of bugs.
      const res = await fetch(`/api/tables/${targetTableId}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: { ...(search ? { search } : {}), limit: 25 },
        }),
      });

      setLoading(false);
      if (!res.ok) return;

      const body = await res.json();
      setResults(
        (body.records as { id: string; data: Record<string, unknown> }[]).map((r) => ({
          id: r.id,
          label: String(r.data[primaryKey] ?? ""),
        }))
      );
    }, 200);

    return () => clearTimeout(t);
  }, [search, targetTableId, primaryKey]);

  const selectedIds = new Set(selected.map((s) => s.id));

  return (
    <div>
      <div className="border-b p-2">
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search records…"
          className="h-8 text-[13px]"
        />
      </div>

      <div className="max-h-64 overflow-auto p-1">
        {loading && (
          <p className="px-2 py-3 text-[13px] text-muted-foreground">Searching…</p>
        )}

        {!loading && results.length === 0 && (
          <p className="px-2 py-3 text-[13px] text-muted-foreground">
            Nothing found.
          </p>
        )}

        {results.map((r) => {
          const isSelected = selectedIds.has(r.id);
          return (
            <button
              key={r.id}
              onClick={() => onToggle(r)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                isSelected && "bg-muted/60"
              )}
            >
              <span className="truncate">{r.label || "Untitled"}</span>
              {isSelected && <Check className="ml-auto size-3.5 text-brand" />}
            </button>
          );
        })}
      </div>

      {!single && selected.length > 0 && (
        <div className="border-t p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[13px] text-muted-foreground"
            onClick={() => selected.forEach(onToggle)}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
