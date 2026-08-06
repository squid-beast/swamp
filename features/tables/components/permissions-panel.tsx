"use client";

import * as React from "react";
import { toast } from "sonner";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  isReadOnlyField,
  PERMISSION_LABEL,
  ROLE_ORDER,
  type Field,
  type Permission,
  type PermissionKey,
  type Role,
} from "../types";

// Who may change what, on one table.
//
// Three switches, and each is one of: "everyone the role ladder allows" (no
// rule), "this rung and above", or "nobody". A rule can only ever NARROW — it
// cannot hand someone access their role denies, because every enforcement point
// reads `swamp_can(...) AND swamp_permission_allows(...)`.
//
// Enforcement is a BEFORE trigger on public.records, so what this panel
// configures holds for the API and public forms too, not just the grid.

type RuleValue = "default" | "nobody" | Role;

function valueOf(rule: Permission | undefined): RuleValue {
  if (!rule) return "default";
  if (rule.grantedType === "nobody") return "nobody";
  if (rule.grantedType === "role" && rule.role) return rule.role;
  return "default";
}

export function PermissionsPanel({
  tableId,
  tableName,
  fields,
  permissions: initial,
  canEdit,
}: {
  tableId: string;
  tableName: string;
  fields: Field[];
  permissions: Permission[];
  /** Creator and up. Below that the switches render read-only. */
  canEdit: boolean;
}) {
  const [rules, setRules] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);

  const find = (key: PermissionKey, fieldId: string | null = null) =>
    rules.find((r) => r.key === key && (r.fieldId ?? null) === fieldId);

  const reload = async () => {
    const res = await fetch(`/api/tables/${tableId}/permissions`);
    if (res.ok) setRules((await res.json()).permissions as Permission[]);
  };

  const set = async (key: PermissionKey, fieldId: string | null, next: RuleValue) => {
    const slot = `${key}:${fieldId ?? ""}`;
    setBusy(slot);

    try {
      if (next === "default") {
        const rule = find(key, fieldId);
        if (rule) {
          const res = await fetch(
            `/api/tables/${tableId}/permissions?ruleId=${rule.id}`,
            { method: "DELETE" }
          );
          if (!res.ok) throw new Error("Could not clear the rule");
        }
      } else {
        const res = await fetch(`/api/tables/${tableId}/permissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            next === "nobody"
              ? { key, fieldId, grantedType: "nobody" }
              : { key, fieldId, grantedType: "role", role: next }
          ),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error ?? "Could not save the rule");
        }
      }
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const Switch = ({
    label,
    hint,
    permKey,
    fieldId = null,
  }: {
    label: string;
    hint?: string;
    permKey: PermissionKey;
    fieldId?: string | null;
  }) => {
    const slot = `${permKey}:${fieldId ?? ""}`;
    const value = valueOf(find(permKey, fieldId));

    return (
      <div className="flex items-center gap-3 py-1.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px]">{label}</span>
          {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        </div>
        <Select
          value={value}
          onValueChange={(v) => set(permKey, fieldId, v as RuleValue)}
          disabled={!canEdit || busy === slot}
        >
          <SelectTrigger className="h-8 w-56 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Anyone with the role</SelectItem>
            {ROLE_ORDER.filter((r) => r !== "viewer" && r !== "commenter").map((r) => (
              <SelectItem key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}s and above
              </SelectItem>
            ))}
            <SelectItem value="nobody">Nobody</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  // A rule on a computed or relational field could never be enforced — its
  // value is not stored in the record — so the database refuses one. Don't
  // offer what will be rejected.
  const editable = fields.filter((f) => !isReadOnlyField(f.type));

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-medium">Permissions — {tableName}</h2>
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        These narrow the role ladder; they never widen it. A rule applies
        everywhere — the grid, the API, public forms — because it is enforced in
        the database, not the interface.
      </p>

      <div className="flex flex-col divide-y">
        <Switch
          label={PERMISSION_LABEL.table_record_add}
          hint="Who may create rows in this table."
          permKey="table_record_add"
        />
        <Switch
          label={PERMISSION_LABEL.table_record_delete}
          hint="Deleting and un-deleting are the same door."
          permKey="table_record_delete"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Lock className="size-3" />
          Lock individual fields
        </Label>
        {editable.length === 0 ? (
          <p className="py-2 text-[12px] text-muted-foreground">
            Nothing lockable — every field here is computed.
          </p>
        ) : (
          <div className="flex flex-col divide-y">
            {editable.map((f) => (
              <Switch key={f.id} label={f.name} permKey="record_field_edit" fieldId={f.id} />
            ))}
          </div>
        )}
      </div>

      {!canEdit && (
        <p className="text-[11px] text-muted-foreground">
          Only creators and owners can change these.
        </p>
      )}
    </section>
  );
}
