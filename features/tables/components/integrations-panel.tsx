"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";

// The integrations page: one screen that answers "how do I get leads IN, and get
// notified OUT". Everything here is real and already shipped — this is the map to
// it, with copy-paste examples wired to this base's real ids and this app's origin.

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 pr-10 font-mono text-[12px] leading-relaxed">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 size-7 opacity-60 group-hover:opacity-100"
        onClick={copy}
        aria-label="Copy"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="font-display text-[15px] font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function IntegrationsPanel({
  baseId,
  baseName,
  tables,
  origin,
}: {
  baseId: string;
  baseName: string;
  tables: { id: string; name: string }[];
  origin: string;
}) {
  const [tableId, setTableId] = React.useState(tables[0]?.id ?? "TABLE_ID");
  const tableName = tables.find((t) => t.id === tableId)?.name ?? "your table";

  const ingestCurl = `curl -X POST ${origin}/api/ingest/${tableId} \\
  -H "Authorization: Bearer swamp_pat_YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "Full Name": "Ada Lovelace", "Email": "ada@example.com" }'`;

  const restCurl = `curl -X POST ${origin}/api/v1/tables/${tableId}/records \\
  -H "Authorization: Bearer swamp_pat_YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "records": [{ "fields": { "fld_email": "ada@example.com" } }] }'`;

  const mcpConfig = `{
  "mcpServers": {
    "swamp": {
      "url": "${origin}/api/v1/mcp",
      "headers": { "Authorization": "Bearer swamp_pat_YOUR_TOKEN" }
    }
  }
}`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          {baseName} — integrations
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Get leads in from a form, a Zap, or your own backend; get notified out to
          Slack, Discord, or any endpoint. Everything below uses a Personal Access
          Token —{" "}
          <Link
            href={`/app/b/${baseId}/api`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            create one on the API tokens page
          </Link>
          .
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <Label className="text-[12px] text-muted-foreground">Examples for table</Label>
        <Select value={tableId} onValueChange={setTableId}>
          <SelectTrigger className="h-8 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tables.length === 0 && (
              <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No tables yet</p>
            )}
            {tables.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── INBOUND ── */}
      <Section title="Inbound — capture leads">
        <p className="text-[13px] text-muted-foreground">
          The <span className="font-medium text-foreground">ingest endpoint</span> is the
          forgiving front door. Send a plain JSON object; keys match your field names{" "}
          <em>or</em> keys, and anything unknown is reported, not rejected. Perfect for a
          Zapier/Make step or a website form posting into “{tableName}”.
        </p>
        <CodeBlock code={ingestCurl} />
        <p className="text-[12px] text-muted-foreground">
          Needs a token with <code className="font-mono">records:write</code>. It returns{" "}
          <code className="font-mono">201</code> with the created record and an{" "}
          <code className="font-mono">ignoredKeys</code> list for anything that matched no
          field. CORS is open, so a browser form can post directly.
        </p>

        <div className="mt-2 border-t pt-3">
          <p className="text-[13px] font-medium">Strict REST API</p>
          <p className="mb-2 text-[12px] text-muted-foreground">
            For scripts you control: keys by field <code className="font-mono">key</code>{" "}
            (stable across renames), full CRUD, cursor pagination, filters. See{" "}
            <a
              href="/api/v1/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
            >
              the OpenAPI docs <ArrowUpRight className="size-3" />
            </a>
            .
          </p>
          <CodeBlock code={restCurl} />
        </div>

        <div className="mt-2 border-t pt-3">
          <p className="text-[13px] font-medium">Public forms</p>
          <p className="text-[12px] text-muted-foreground">
            No code at all: open a table, add a <span className="font-medium">Form</span>{" "}
            view, and share its link. Submissions land as records with per-form rate
            limiting — no token required.
          </p>
        </div>
      </Section>

      {/* ── OUTBOUND ── */}
      <Section title="Outbound — get notified">
        <p className="text-[13px] text-muted-foreground">
          A <span className="font-medium text-foreground">workflow</span> watches a table
          and calls out when a record matches — your endpoint (signed JSON), Slack, or
          Discord, with an optional condition and message template.
        </p>
        <Link
          href={`/app/b/${baseId}/automations`}
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium",
            "hover:bg-muted"
          )}
        >
          Open Workflows
          <ArrowUpRight className="size-3.5" />
        </Link>
        <p className="text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">Zapier / Make:</span> point a
          “Catch Hook” trigger at your Zap’s URL as a generic workflow to push events out;
          use the ingest endpoint above as a Zap <em>action</em> to pull leads in. Between
          the two, Swamp connects to anything those platforms reach.
        </p>
      </Section>

      {/* ── MCP ── */}
      <Section title="AI agents — MCP">
        <p className="text-[13px] text-muted-foreground">
          Swamp speaks the{" "}
          <span className="font-medium text-foreground">Model Context Protocol</span>, so an
          agent (Claude, Cursor, your own) can read and write this base with the same token
          and the same permissions. Add this to your MCP client config:
        </p>
        <CodeBlock code={mcpConfig} />
        <p className="text-[12px] text-muted-foreground">
          Tools: <code className="font-mono">list_tables</code>,{" "}
          <code className="font-mono">describe_table</code>,{" "}
          <code className="font-mono">query_records</code>,{" "}
          <code className="font-mono">count_records</code>,{" "}
          <code className="font-mono">get_record</code>,{" "}
          <code className="font-mono">create_records</code>,{" "}
          <code className="font-mono">update_record</code>,{" "}
          <code className="font-mono">delete_records</code>. Reads need{" "}
          <code className="font-mono">records:read</code>; writes need{" "}
          <code className="font-mono">records:write</code>.
        </p>
      </Section>
    </main>
  );
}
