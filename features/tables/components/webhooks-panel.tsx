"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { Label } from "@/shared/ui/label";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_KINDS,
  type Field,
  type FilterNode,
  type Table,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookKind,
} from "../types";
import { FilterBuilder } from "./filter-builder";

// Webhooks.
//
// The delivery log is not a nice-to-have. Nobody has ever debugged a webhook from
// the outside: the receiver says "we never got it" and the sender says "we sent
// it", and without a log of what left this building and what came back, that
// argument has no end.

const ANY = "__any__";

// Plain-English trigger names; the raw event (record.created) is what rides in the
// webhook payload, so it stays reachable on hover for whoever writes the receiver.
const EVENT_LABELS: Record<WebhookEvent, string> = {
  "record.created": "Record created",
  "record.updated": "Record updated",
  "record.deleted": "Record deleted",
  "comment.created": "Comment added",
  "button.clicked": "Button clicked",
};

const eventLabel = (e: string) => EVENT_LABELS[e as WebhookEvent] ?? e;

// A webhook's target speaks one of several shapes. Generic is Swamp's signed
// envelope; the chat kinds are each tool's incoming-webhook shape; email has no
// URL at all and goes out through the app's sender.
const KIND_LABELS: Record<WebhookKind, string> = {
  generic: "Generic (signed JSON)",
  slack: "Slack",
  discord: "Discord",
  teams: "Microsoft Teams",
  mattermost: "Mattermost",
  email: "Email",
};

const KIND_HINTS: Record<WebhookKind, string> = {
  generic: "Our signed { event, record, changes } envelope. Verify X-Swamp-Signature.",
  slack: "Posts { text } to a Slack incoming webhook.",
  discord: "Posts { content } to a Discord webhook.",
  teams: "Posts an Adaptive Card to a Teams Workflows webhook (the legacy O365 connector is retired).",
  mattermost: "Posts { text } to a Mattermost incoming webhook.",
  email: "Sends the message by email. No URL — just a recipient.",
};

export function WebhooksPanel({
  baseId,
  baseName,
  tables,
  webhooks: initial,
}: {
  baseId: string;
  baseName: string;
  tables: Table[];
  webhooks: Webhook[];
}) {
  const [webhooks, setWebhooks] = React.useState(initial);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [tableId, setTableId] = React.useState<string>(ANY);
  const [events, setEvents] = React.useState<WebhookEvent[]>([
    "record.created",
    "record.updated",
  ]);
  const [kind, setKind] = React.useState<WebhookKind>("generic");
  const [template, setTemplate] = React.useState("");
  const [emailTo, setEmailTo] = React.useState("");
  const [testing, setTesting] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<WebhookDelivery[]>([]);

  // A workflow can be narrowed two ways, both already honoured by the engine but
  // never before offered: a CONDITION (only fire when the record matches) and a
  // FIELD SCOPE (for updates, only fire when one of these fields changed). Both
  // need the chosen table's fields, so they appear only once a table is picked.
  const [condition, setCondition] = React.useState<FilterNode | null>(null);
  const [fieldIds, setFieldIds] = React.useState<string[]>([]);
  const [tableFields, setTableFields] = React.useState<Field[]>([]);

  React.useEffect(() => {
    setCondition(null);
    setFieldIds([]);
    if (tableId === ANY) {
      setTableFields([]);
      return;
    }
    let alive = true;
    void fetch(`/api/tables/${tableId}/fields`)
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((b) => alive && setTableFields((b.fields ?? []) as Field[]))
      .catch(() => alive && setTableFields([]));
    return () => {
      alive = false;
    };
  }, [tableId]);

  const toggleField = (id: string) =>
    setFieldIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const reload = async () => {
    const res = await fetch(`/api/bases/${baseId}/webhooks`);
    if (res.ok) setWebhooks((await res.json()).webhooks as Webhook[]);
  };

  const toggleEvent = (e: WebhookEvent) =>
    setEvents((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]));

  const create = async () => {
    const isEmail = kind === "email";
    if (!name.trim() || !events.length || busy) return;
    if (isEmail ? !emailTo.trim() : !url.trim()) return;
    setBusy(true);

    const res = await fetch(`/api/bases/${baseId}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        url: isEmail ? null : url.trim(),
        tableId: tableId === ANY ? null : tableId,
        events,
        // Condition and field scope only mean anything against a specific table.
        ...(tableId !== ANY && condition ? { condition } : {}),
        ...(tableId !== ANY && fieldIds.length ? { fieldIds } : {}),
        kind,
        template: kind !== "generic" && template.trim() ? template.trim() : null,
        ...(isEmail ? { config: { to: emailTo.trim() } } : {}),
      }),
    });

    setBusy(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return toast.error(err?.error ?? "Could not create the workflow");
    }

    setName("");
    setUrl("");
    setEmailTo("");
    setTemplate("");
    setCondition(null);
    setFieldIds([]);
    await reload();
  };

  /** Send a synthetic delivery through the REAL send path and report back. */
  const test = async (id: string) => {
    if (testing) return;
    setTesting(id);
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
      const out = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(out?.error ?? "Test failed");
      } else if (out.ok) {
        toast.success(`Delivered — HTTP ${out.status ?? "OK"}`);
      } else {
        toast.error(out.error ? `Failed: ${out.error}` : `Failed — HTTP ${out.status}`);
      }
    } finally {
      setTesting(null);
    }
  };

  const setActive = async (id: string, active: boolean) => {
    const res = await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });

    if (!res.ok) return toast.error("Could not change it");
    await reload();
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Could not delete it");
    setWebhooks((w) => w.filter((x) => x.id !== id));
  };

  const showLog = async (id: string) => {
    if (open === id) return setOpen(null);

    const res = await fetch(`/api/webhooks/${id}/deliveries`);
    if (!res.ok) return toast.error("Could not load the log");

    setLog((await res.json()).deliveries as WebhookDelivery[]);
    setOpen(id);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">
        {baseName} — workflows
      </h1>

      <p className="mt-1 text-[13px] text-muted-foreground">
        A workflow watches a table and, when a record matches, calls out — your own
        endpoint, Slack, or Discord. Every call is signed: verify{" "}
        <code className="font-mono text-[12px]">X-Swamp-Signature</code> against the
        secret, and treat <code className="font-mono text-[12px]">X-Swamp-Delivery</code>{" "}
        as an idempotency key, because delivery is at-least-once.
      </p>

      <section className="mt-6 flex flex-col gap-3 rounded-xl border p-4">
        <Label className="text-[12px] text-muted-foreground">New workflow</Label>

        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-48"
          />
          {kind === "email" ? (
            <Input
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="ops@example.com"
              type="email"
              className="flex-1"
            />
          ) : (
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hooks/swamp"
              className="flex-1"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={tableId} onValueChange={setTableId}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Every table</SelectItem>
              {tables.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={create}
            disabled={!name.trim() || !url.trim() || !events.length || busy}
            className="ml-auto gap-1.5"
          >
            <Plus className="size-3.5" />
            Create
          </Button>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {WEBHOOK_EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox checked={events.includes(e)} onCheckedChange={() => toggleEvent(e)} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{EVENT_LABELS[e]}</span>
                </TooltipTrigger>
                <TooltipContent>
                  Event: <span className="font-mono">{e}</span>
                </TooltipContent>
              </Tooltip>
            </label>
          ))}
        </div>

        {tableId !== ANY && tableFields.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] text-muted-foreground">
                Run only when… <span className="font-normal">(optional condition)</span>
              </Label>
              <FilterBuilder fields={tableFields} value={condition} onChange={setCondition} />
              <p className="text-[11px] text-muted-foreground">
                Leave empty to run on every matching change. Otherwise the workflow only
                fires for records that match — e.g. <span className="font-mono">Status is New</span>.
              </p>
            </div>

            {events.includes("record.updated") && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-[12px] text-muted-foreground">
                  Only when these fields change{" "}
                  <span className="font-normal">(optional, updates only)</span>
                </Label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {tableFields.map((f) => (
                    <label key={f.id} className="flex items-center gap-1.5 text-[13px]">
                      <Checkbox
                        checked={fieldIds.includes(f.id)}
                        onCheckedChange={() => toggleField(f.id)}
                      />
                      <span>{f.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Leave all unchecked to fire on any update.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label className="text-[12px] text-muted-foreground">Delivery format</Label>
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as WebhookKind)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEBHOOK_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">{KIND_HINTS[kind]}</span>
          </div>
        </div>

        {kind !== "generic" && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px] text-muted-foreground">
              Message (optional)
            </Label>
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={"New lead: {{fields.fld_name}} ({{fields.fld_email}})"}
              className="font-mono text-[12px]"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Use <code className="font-mono">{"{{event}}"}</code>,{" "}
              <code className="font-mono">{"{{recordId}}"}</code> and{" "}
              <code className="font-mono">{"{{fields.<key>}}"}</code> (the field key from{" "}
              your API meta). Leave blank for an automatic summary of the record.
            </p>
          </div>
        )}
      </section>

      <section className="mt-6 flex flex-col gap-2">
        <h2 className="text-[13px] font-medium">Workflows</h2>

        {!webhooks.length && <p className="text-[13px] text-muted-foreground">None yet.</p>}

        {webhooks.map((w) => (
          <div key={w.id} className="rounded-lg border" data-testid="webhook">
            <div className="flex items-center gap-2 px-3 py-2">
              <Checkbox
                checked={w.active}
                onCheckedChange={(c) => setActive(w.id, !!c)}
                aria-label={`${w.active ? "Disable" : "Enable"} ${w.name}`}
              />

              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px]">{w.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {w.kind !== "generic" && `${KIND_LABELS[w.kind]} · `}
                  {w.kind === "email" ? String(w.config?.to ?? "") : w.url} ·{" "}
                  {w.events.map(eventLabel).join(", ")}
                </span>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-[12px]"
                onClick={() => test(w.id)}
                disabled={testing === w.id}
                data-testid="webhook-test"
              >
                {testing === w.id ? "Testing…" : "Test"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-[12px]"
                onClick={() => {
                  void navigator.clipboard.writeText(w.secret);
                  toast.success("Signing secret copied");
                }}
              >
                <Copy className="size-3" />
                Secret
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[12px]"
                onClick={() => showLog(w.id)}
              >
                {open === w.id ? "Hide log" : "Log"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-destructive"
                onClick={() => remove(w.id)}
                aria-label={`Delete ${w.name}`}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>

            {open === w.id && (
              <div className="border-t px-3 py-2" data-testid="delivery-log">
                {!log.length && (
                  <p className="text-[12px] text-muted-foreground">
                    Nothing delivered yet.
                  </p>
                )}

                {log.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 py-1 text-[12px]">
                    <span className="w-16 shrink-0 font-mono">{d.status}</span>
                    <span className="w-32 shrink-0 truncate text-muted-foreground">
                      {eventLabel(d.event)}
                    </span>
                    <span className="w-14 shrink-0 text-muted-foreground">
                      {d.responseStatus ?? "—"}
                    </span>
                    <span className="w-16 shrink-0 text-muted-foreground">
                      {d.attempts} {d.attempts === 1 ? "try" : "tries"}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {d.error ?? d.responseBody ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
      </main>
    </TooltipProvider>
  );
}
