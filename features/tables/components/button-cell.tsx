"use client";

import * as React from "react";
import { toast } from "sonner";
import { ExternalLink, Zap } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { Field } from "../types";

// The button cell.
//
// Two kinds, and they are genuinely different things:
//
//   url     — the value IS the href. It was compiled from a formula, in Postgres,
//             per record, and merged into `data` like any other computed field.
//             So `record.data[field.key]` is already the URL, and this component
//             does nothing clever: it renders an anchor.
//
//   webhook — pressing it POSTs to our server, which queues a delivery. The target
//             URL and the secret stay server-side. A button that fetched its own
//             URL from the browser would put both in the page source, where anyone
//             who can open devtools can press it as often as they like.

export function ButtonCell({
  field,
  recordId,
  value,
}: {
  field: Field;
  recordId: string;
  value: unknown;
}) {
  const [busy, setBusy] = React.useState(false);

  const label = field.options.label ?? field.name;
  const action = field.options.action ?? "url";

  if (action === "url") {
    const href = typeof value === "string" && value.trim() ? value : null;

    // A formula that couldn't resolve for THIS record — a blank field it depends
    // on, most often. Disabled, not hidden: a button that vanishes is a bug report.
    if (!href) {
      return (
        <span className="px-2 text-[12px] text-muted-foreground" title="No URL for this record">
          {label}
        </span>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 text-[12px] text-primary underline-offset-2 hover:underline"
      >
        <ExternalLink className="size-3" />
        {label}
      </a>
    );
  }

  const run = async () => {
    setBusy(true);

    const res = await fetch(`/api/records/${recordId}/button`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId: field.id }),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return toast.error(body?.error ?? "That button didn't run");
    }

    // "Queued", not "done". The delivery happens out of band, with retries — and
    // saying "done" when we mean "we'll try" is how a user concludes the button is
    // broken the one time the receiver is down.
    toast.success("Queued. See the delivery log for the result.");
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={run}
      className="h-6 gap-1 px-2 text-[12px]"
      data-testid="button-cell"
    >
      <Zap className="size-3" />
      {label}
    </Button>
  );
}
