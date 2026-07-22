"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { TOKEN_SCOPES, type ApiToken, type TokenScope } from "../types";

// API tokens.
//
// The one screen in the product where a piece of state is deliberately
// unrecoverable: the token is shown once, and then it is gone from everywhere
// except wherever the user put it. That is not an inconvenience to design around
// — it is the reason the feature is safe, so the UI says so out loud rather than
// hiding it behind a "you won't see this again" toast nobody reads.

// Plain-English name shown to people; the raw scope (records:read) is the API
// string, kept one hover away for the developer who needs the exact value.
const SCOPE_LABEL: Record<TokenScope, string> = {
  "records:read": "Read records",
  "records:write": "Write records",
};

const SCOPE_HINTS: Record<TokenScope, string> = {
  "records:read": "View records through the API. Can't make changes.",
  "records:write": "Create, update and delete records.",
};

const scopeLabel = (s: string) => SCOPE_LABEL[s as TokenScope] ?? s;

/** 90 days. A token with no expiry is a credential that outlives the reason it was
 *  made — the integration is switched off, nobody revokes the key, and it sits
 *  there with write access for three years. */
const DEFAULT_DAYS = 90;

export function TokensPanel({
  baseId,
  baseName,
  tables = [],
  tokens: initial,
}: {
  baseId: string;
  baseName: string;
  tables?: { id: string; name: string }[];
  tokens: ApiToken[];
}) {
  const [tokens, setTokens] = React.useState(initial);
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<TokenScope[]>(["records:read"]);
  const [tableIds, setTableIds] = React.useState<string[]>([]);
  const [days, setDays] = React.useState(String(DEFAULT_DAYS));
  const [minted, setMinted] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const tableName = React.useCallback(
    (id: string) => tables.find((t) => t.id === id)?.name ?? "a table",
    [tables]
  );

  const reload = async () => {
    const res = await fetch(`/api/bases/${baseId}/tokens`);
    if (res.ok) setTokens((await res.json()).tokens as ApiToken[]);
  };

  const toggle = (scope: TokenScope) =>
    setScopes((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));

  const toggleTable = (id: string) =>
    setTableIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const create = async () => {
    if (!name.trim() || !scopes.length || busy) return;
    setBusy(true);

    const n = Number(days);
    const expiresAt =
      Number.isFinite(n) && n > 0
        ? new Date(Date.now() + n * 86_400_000).toISOString()
        : null;

    const res = await fetch(`/api/bases/${baseId}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), scopes, expiresAt, tableIds }),
    });

    setBusy(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return toast.error(err?.error ?? "Could not create the token");
    }

    const body = await res.json();
    setMinted(body.token as string);
    setName("");
    setTableIds([]);
    await reload();
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Could not revoke it");
    await reload();
  };

  return (
    <TooltipProvider delayDuration={150}>
      <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">
        {baseName} — API
      </h1>

      <p className="mt-1 text-[13px] text-muted-foreground">
        A token acts as <strong>you</strong>. It can never do more than you can — if
        your role changes, so does what it can reach, on the next request.
      </p>

      <div className="mt-3 flex flex-col gap-1 rounded-lg border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        <span>
          REST reference:{" "}
          <a href="/api/v1/docs" target="_blank" rel="noreferrer" className="font-medium underline">
            /api/v1/docs
          </a>
        </span>
        <span>
          MCP endpoint (for AI agents like Claude or Cursor):{" "}
          <code className="font-mono">/api/v1/mcp</code> — authenticate with{" "}
          <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>.
        </span>
      </div>

      {minted && (
        <section
          className="mt-4 flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-4"
          data-testid="minted-token"
        >
          <Label className="text-[12px]">
            Copy this now. It is not stored anywhere and will not be shown again.
          </Label>

          <div className="flex gap-2">
            <code className="flex-1 truncate rounded border bg-background px-2 py-1.5 font-mono text-[12px]">
              {minted}
            </code>

            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(minted);
                toast.success("Copied");
              }}
              className="gap-1.5"
            >
              <Copy className="size-3.5" />
              Copy
            </Button>

            <Button size="sm" variant="ghost" onClick={() => setMinted(null)}>
              Done
            </Button>
          </div>
        </section>
      )}

      <section className="mt-6 flex flex-col gap-3 rounded-xl border p-4">
        <Label className="text-[12px] text-muted-foreground">New token</Label>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is it for? e.g. Nightly sync"
        />

        <div className="flex flex-col gap-2">
          {TOKEN_SCOPES.map((scope) => (
            <label key={scope} className="flex items-start gap-2 text-[13px]">
              <Checkbox
                className="mt-0.5"
                checked={scopes.includes(scope)}
                onCheckedChange={() => toggle(scope)}
              />
              <span className="flex flex-col">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="w-fit font-medium">{SCOPE_LABEL[scope]}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    API scope: <span className="font-mono">{scope}</span>
                  </TooltipContent>
                </Tooltip>
                <span className="text-muted-foreground">{SCOPE_HINTS[scope]}</span>
              </span>
            </label>
          ))}
        </div>

        {tables.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label className="text-[12px] text-muted-foreground">
              Tables it can reach
            </Label>
            <p className="text-[12px] text-muted-foreground">
              Leave all unticked for the whole base. Tick some to pin the token —
              a lead-ingest key that can only reach the tables it needs.
            </p>
            <div className="flex flex-col gap-1.5">
              {tables.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={tableIds.includes(t.id)}
                    onCheckedChange={() => toggleTable(t.id)}
                  />
                  <span className="truncate">{t.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Label className="text-[12px] text-muted-foreground">Expires in</Label>
          <Input
            type="number"
            min={0}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-24"
          />
          <span className="text-[12px] text-muted-foreground">days (0 = never)</span>

          <Button
            onClick={create}
            disabled={!name.trim() || !scopes.length || busy}
            className="ml-auto gap-1.5"
          >
            <KeyRound className="size-3.5" />
            Create
          </Button>
        </div>
      </section>

      <section className="mt-6 flex flex-col gap-2">
        <h2 className="text-[13px] font-medium">Tokens</h2>

        {!tokens.length && (
          <p className="text-[13px] text-muted-foreground">None yet.</p>
        )}

        {tokens.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-lg border px-3 py-2"
            data-testid="token"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px]">{t.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                <span className="font-mono">{t.prefix}…</span> ·{" "}
                {t.scopes.map(scopeLabel).join(", ")} ·{" "}
                {t.tableIds.length
                  ? t.tableIds.map(tableName).join(", ")
                  : "all tables"}
              </span>
            </div>

            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {t.revokedAt
                ? "revoked"
                : t.expiresAt && new Date(t.expiresAt) <= new Date()
                  ? "expired"
                  : t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : "never used"}
            </span>

            {!t.revokedAt && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-destructive"
                onClick={() => revoke(t.id)}
                aria-label={`Revoke ${t.name}`}
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        ))}
      </section>
      </main>
    </TooltipProvider>
  );
}
