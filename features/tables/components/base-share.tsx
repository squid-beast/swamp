"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Globe } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

// Share a whole base: one public page listing the views that are THEMSELVES
// shared. The server never exposes records or fields through this — see
// swamp_shared_base — so this control is honest about what the link shows.

export function BaseShare({
  baseId,
  shareId: initial,
}: {
  baseId: string;
  /** The current share id, if the base is already shared. */
  shareId: string | null;
}) {
  const [shareId, setShareId] = React.useState(initial);
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const url = shareId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/b/${shareId}`
    : null;

  const share = async () => {
    setBusy(true);
    const res = await fetch(`/api/bases/${baseId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(password ? { password } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Could not share the base");
    setShareId((await res.json()).shareId as string);
    setPassword("");
  };

  const unshare = async () => {
    setBusy(true);
    const res = await fetch(`/api/bases/${baseId}/share`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error("Could not stop sharing");
    setShareId(null);
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex items-center gap-1.5">
        <Globe className="size-3.5 text-muted-foreground" />
        <h2 className="text-[13px] font-medium">Share this base</h2>
      </div>
      <p className="text-[12px] text-muted-foreground">
        One public page listing this base&apos;s shared views. Views you haven&apos;t
        shared individually stay private.
      </p>

      {url ? (
        <div className="flex items-center gap-2">
          <Input readOnly value={url} className="h-8 flex-1 font-mono text-[12px]" />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[12px]"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              toast.success("Link copied");
            }}
          >
            <Copy className="size-3" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[12px] text-destructive"
            disabled={busy}
            onClick={unshare}
          >
            Stop sharing
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (optional)"
            className="h-8 w-52 text-[13px]"
          />
          <Button size="sm" className="h-8 text-[12px]" disabled={busy} onClick={share}>
            Create link
          </Button>
        </div>
      )}
    </section>
  );
}
