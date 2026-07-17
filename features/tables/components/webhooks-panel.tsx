"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { WEBHOOK_EVENTS, type Table, type Webhook, type WebhookDelivery, type WebhookEvent } from "../types";

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
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<WebhookDelivery[]>([]);

  const reload = async () => {
    const res = await fetch(`/api/bases/${baseId}/webhooks`);
    if (res.ok) setWebhooks((await res.json()).webhooks as Webhook[]);
  };

  const toggleEvent = (e: WebhookEvent) =>
    setEvents((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]));

  const create = async () => {
    if (!name.trim() || !url.trim() || !events.length || busy) return;
    setBusy(true);

    const res = await fetch(`/api/bases/${baseId}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        url: url.trim(),
        tableId: tableId === ANY ? null : tableId,
        events,
      }),
    });

    setBusy(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return toast.error(err?.error ?? "Could not create the webhook");
    }

    setName("");
    setUrl("");
    await reload();
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
        {baseName} — automations
      </h1>

      <p className="mt-1 text-[13px] text-muted-foreground">
        We POST to your URL when something changes. Every call is signed — verify{" "}
        <code className="font-mono text-[12px]">X-Swamp-Signature</code> against the
        secret, and treat <code className="font-mono text-[12px]">X-Swamp-Delivery</code>{" "}
        as an idempotency key: delivery is at-least-once.
      </p>

      <section className="mt-6 flex flex-col gap-3 rounded-xl border p-4">
        <Label className="text-[12px] text-muted-foreground">New webhook</Label>

        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-48"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/swamp"
            className="flex-1"
          />
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
      </section>

      <section className="mt-6 flex flex-col gap-2">
        <h2 className="text-[13px] font-medium">Webhooks</h2>

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
                  {w.url} · {w.events.map(eventLabel).join(", ")}
                </span>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 gap-1.5 text-[12px]"
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
