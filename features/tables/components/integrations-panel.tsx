"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  FileSpreadsheet,
  Globe,
  KeyRound,
  Webhook,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

// The integrations page: one screen that answers, in order, the three questions a
// confused user actually has — "how do I get a key?", "where do I send data?",
// and "how do I connect tool X?". Every example is wired to this base's real ids
// and this app's origin, so a copy-paste works with only the token filled in.
//
// It's a how-to surface, so it reads as numbered steps, not marketing.

// ── small building blocks ───────────────────────────────────────────────────

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
  icon: Icon,
  title,
  tag,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tag?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
          <Icon className="size-4 text-foreground" />
        </span>
        <h2 className="font-display text-[15px] font-bold tracking-tight">{title}</h2>
        {tag && (
          <span className="ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {tag}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="flex flex-col gap-3">{children}</ol>;
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug">{title}</p>
        {children && (
          <div className="mt-1.5 flex flex-col gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
            {children}
          </div>
        )}
      </div>
    </li>
  );
}

/** Inline code, used constantly below for headers, scopes and keys. */
function C({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[0.92em] text-foreground">{children}</code>;
}

// ── page ────────────────────────────────────────────────────────────────────

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

  const tokensHref = `/app/b/${baseId}/api`;

  const ingestUrl = `${origin}/api/ingest/${tableId}`;
  const ingestCurl = `curl -X POST ${ingestUrl} \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "Full Name": "Ada Lovelace", "Email": "ada@example.com" }'`;

  const ingestRetryCurl = `curl -X POST "${ingestUrl}?upsertOn=Email" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 6b9c1e2a-…" \\
  -d '{ "Full Name": "Ada Lovelace", "Email": "ada@example.com" }'`;

  const restCurl = `curl -X POST ${origin}/api/v1/tables/${tableId}/records \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "records": [{ "fields": { "fld_email": "ada@example.com" } }] }'`;

  const mcpConfig = `{
  "mcpServers": {
    "swamp": {
      "url": "${origin}/api/v1/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          {baseName} — integrations
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Three ways to move data: <span className="font-medium text-foreground">in</span>{" "}
          from a form, another tool, or your backend;{" "}
          <span className="font-medium text-foreground">out</span> to Slack, Discord, or any
          URL; and <span className="font-medium text-foreground">both ways</span> for an AI
          agent. Start with the token below, then pick a path.
        </p>
      </div>

      {/* Which table the examples target — every URL below uses this id. */}
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <Label className="text-[12px] text-muted-foreground">Show examples for</Label>
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

      {/* ── STEP 1: TOKEN ── */}
      <Section icon={KeyRound} title="Step 1 · Get your access token" tag="do this first">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          A token (a “Personal Access Token”, also called a{" "}
          <span className="font-medium text-foreground">bearer token</span>) is the password
          your integrations use. It acts as you and can never do more than your role allows.
        </p>
        <Steps>
          <Step n={1} title={<>Open the API tokens page</>}>
            <Link
              href={tokensHref}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <KeyRound className="size-3.5" />
              Create a token
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Step>
          <Step n={2} title="Choose what it can do (its scope)">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <C>records:read</C> — read only. Use for dashboards or an AI agent that just
                answers questions.
              </li>
              <li>
                <C>records:write</C> — create, update, delete. Use for anything that{" "}
                <span className="font-medium text-foreground">captures leads</span> (forms,
                Zapier, your backend).
              </li>
            </ul>
            <p>Optionally pin it to just this table so a leaked key can’t touch the rest.</p>
          </Step>
          <Step n={3} title="Copy it once — it’s shown a single time">
            The token looks like <C>swamp_pat_a1b2c3…</C>. Paste it somewhere safe now; SWAMP
            never shows it again. Lost it? Just make a new one and revoke the old.
          </Step>
          <Step n={4} title="Send it on every request as a header">
            Wherever a tool asks for a header or authorization, use exactly this — the word
            “Bearer”, a space, then your token:
            <CodeBlock code={`Authorization: Bearer YOUR_TOKEN`} />
          </Step>
        </Steps>
      </Section>

      {/* ── INBOUND ── */}
      <Section icon={Globe} title="Capture leads — no code" tag="easiest">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Two ways to collect data without writing anything. Neither needs a token.
        </p>
        <Steps>
          <Step n={1} title="A SWAMP form">
            Open <span className="font-medium text-foreground">{tableName}</span>, add a{" "}
            <span className="font-medium text-foreground">Form</span> view, and share its
            link. Every submission becomes a record. Rate-limited automatically.
          </Step>
          <Step
            n={2}
            title={
              <>
                A Google Form / Sheet{" "}
                <FileSpreadsheet className="inline size-3.5 -translate-y-px opacity-70" />
              </>
            }
          >
            <Link
              href="/app/connect"
              className="inline-flex w-fit items-center gap-1.5 font-medium text-foreground underline underline-offset-2"
            >
              Connect a sheet <ArrowUpRight className="size-3" />
            </Link>{" "}
            — link your Google Form’s responses sheet and new responses are pulled in each
            time you open the table.
          </Step>
        </Steps>
      </Section>

      {/* ── INGEST ── */}
      <Section icon={Webhook} title="Capture leads from another tool" tag="records:write">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          The <span className="font-medium text-foreground">ingest endpoint</span> is the
          forgiving front door — perfect for a Zapier / Make step or a website form. Send a
          plain JSON object; keys are matched to your{" "}
          <span className="font-medium text-foreground">column names</span> (or field keys),
          so <C>{`{"Full Name": "Ada"}`}</C> just works. Anything unmatched comes back in{" "}
          <C>ignoredKeys</C> — reported, never rejected.
        </p>
        <Steps>
          <Step n={1} title="Point your tool at this URL, method POST">
            <CodeBlock code={ingestUrl} />
          </Step>
          <Step n={2} title="Add the auth + content-type headers">
            <CodeBlock code={`Authorization: Bearer YOUR_TOKEN\nContent-Type: application/json`} />
          </Step>
          <Step n={3} title="Send the fields as JSON — full example">
            <CodeBlock code={ingestCurl} />
            Success returns <C>201</C> with the created record. CORS is open, so a browser
            form can post here directly.
          </Step>
          <Step n={4} title="Make retries safe">
            A retry after a timeout or <C>502</C> (Zapier and Make retry automatically) can
            otherwise create a duplicate. Two guards, either or both:
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Send a unique <C>Idempotency-Key</C> header. Replay the same key and the
                original response comes back untouched — no second record.
              </li>
              <li>
                Add <C>?upsertOn=Email</C> (any column name). A record whose{" "}
                <span className="font-medium text-foreground">Email</span> matches an existing
                one updates it instead of inserting a duplicate; the response then also
                includes <C>created</C> and <C>updated</C> counts.
              </li>
            </ul>
            <CodeBlock code={ingestRetryCurl} />
          </Step>
        </Steps>
        <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">In Zapier / Make:</span> add a
          “Webhooks → POST” action, paste the URL, set the header, and map form fields to
          JSON keys named after your columns.
        </div>
      </Section>

      {/* ── REST ── */}
      <Section icon={Webhook} title="Full REST API — for developers" tag="records:read/write">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          For scripts you control: address fields by their stable{" "}
          <C>key</C> (unchanged across renames), with full CRUD, cursor pagination and
          filters. Find each field’s key in the field’s menu, or list them via{" "}
          <C>GET {origin}/api/v1/meta</C>.
        </p>
        <CodeBlock code={restCurl} />
        <a
          href="/api/v1/docs"
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-foreground underline underline-offset-2"
        >
          Full OpenAPI reference <ArrowUpRight className="size-3" />
        </a>
      </Section>

      {/* ── OUTBOUND ── */}
      <Section icon={ArrowUpRight} title="Send notifications out — workflows" tag="no token">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          A <span className="font-medium text-foreground">workflow</span> watches a table and
          calls out when a record matches — your endpoint (signed JSON), Slack, or Discord.
        </p>
        <Steps>
          <Step n={1} title="Open Workflows and add one">
            <Link
              href={`/app/b/${baseId}/automations`}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
            >
              Open Workflows
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Step>
          <Step n={2} title="Pick a trigger and destination">
            Choose the table and event (e.g. record created), an optional condition, then a
            Slack/Discord webhook URL or your own endpoint with a message template.
          </Step>
          <Step n={3} title="Get a Slack or Discord webhook URL">
            In Slack: <span className="font-medium text-foreground">Incoming Webhooks</span>.
            In Discord: <span className="font-medium text-foreground">Channel → Edit →
            Integrations → Webhooks</span>. Paste that URL into the workflow.
          </Step>
        </Steps>
      </Section>

      {/* ── MCP ── */}
      <Section icon={Bot} title="Connect an AI agent — MCP" tag="records:read/write">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          SWAMP speaks the{" "}
          <span className="font-medium text-foreground">Model Context Protocol</span>, so an
          agent (Claude, Cursor, your own) can read and write this base — same token, same
          permissions.
        </p>
        <Steps>
          <Step n={1} title="Open your agent’s MCP settings">
            Cursor: <C>Settings → MCP</C>. Claude Desktop: edit{" "}
            <C>claude_desktop_config.json</C>.
          </Step>
          <Step n={2} title="Add SWAMP as a server">
            Paste this and replace <C>YOUR_TOKEN</C> with a token from Step 1:
            <CodeBlock code={mcpConfig} />
          </Step>
          <Step n={3} title="Restart the agent and ask">
            Try “How many leads came in this week?”. The agent uses these tools:
            <p className="text-muted-foreground">
              <C>list_tables</C>, <C>describe_table</C>, <C>query_records</C>,{" "}
              <C>count_records</C>, <C>get_record</C>, <C>create_records</C>,{" "}
              <C>update_record</C>, <C>delete_records</C>. Reads need{" "}
              <C>records:read</C>; writes need <C>records:write</C>.
            </p>
          </Step>
        </Steps>
      </Section>
    </main>
  );
}
