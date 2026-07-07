"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type StepState = "done" | "active" | "todo";

// A numbered step with a status dot and a connector line to the next step.
function Step({
  n,
  title,
  state,
  last,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex gap-3.5", state === "todo" && "opacity-55")}>
      <div className="flex flex-col items-center gap-1">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border text-[12.5px] font-semibold",
            state === "done"
              ? "border-brand bg-brand text-brand-foreground"
              : state === "active"
                ? "border-brand text-brand"
                : "border-border text-muted-foreground"
          )}
        >
          {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : n}
        </div>
        {!last && <div className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-6")}>
        <div className="text-[13.5px] font-semibold leading-7">{title}</div>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

export function ConnectPanel({ googleConnected }: { googleConnected: boolean }) {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [spreadsheetId, setSpreadsheetId] = React.useState("");
  const [tabs, setTabs] = React.useState<string[] | null>(null);
  const [tab, setTab] = React.useState("");
  const [busy, setBusy] = React.useState<false | "tabs" | "create">(false);

  const connectGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/spreadsheets.readonly",
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: `${window.location.origin}/auth/callback?next=/app/connect`,
      },
    });
  };

  const loadTabs = async () => {
    setBusy("tabs");
    const res = await fetch("/api/sheets/tabs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(json.error ?? "Could not read the sheet");
    setSpreadsheetId(json.spreadsheetId);
    setTabs(json.tabs);
    setTab(json.tabs[0] ?? "");
  };

  const create = async () => {
    setBusy("create");
    const res = await fetch("/api/sheets/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spreadsheetId, sheetTitle: tab }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(json.error ?? "Could not connect the sheet");
    toast.success("Sheet connected");
    router.push(`/d/${json.datasetId}`);
    router.refresh();
  };

  const step2State: StepState = !googleConnected ? "todo" : tabs ? "done" : "active";
  const step3State: StepState = !tabs ? "todo" : "active";

  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6">
      {/* Step 1 — connect Google */}
      <Step n={1} title="Connect your Google account" state={googleConnected ? "done" : "active"}>
        {googleConnected ? (
          <p className="text-[12.5px] text-muted-foreground">
            Connected — SWAMP has read-only access to the sheets you choose.{" "}
            <button onClick={connectGoogle} className="font-medium text-brand hover:underline">
              Reconnect
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              We request <span className="font-medium text-foreground">read-only</span> access, and
              you pick exactly which sheet to import.
            </p>
            <Button onClick={connectGoogle} className="w-fit">
              Connect Google account
            </Button>
          </div>
        )}
      </Step>

      {/* Step 2 — paste the responses sheet link */}
      <Step n={2} title="Paste your Google Sheet link" state={step2State}>
        <div className="flex flex-col gap-2.5">
          <ol className="ml-4 list-decimal space-y-1 text-[12.5px] leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
            <li>
              Open your Google Form, then the{" "}
              <span className="font-medium text-foreground">Responses</span> tab.
            </li>
            <li>
              Click <span className="font-medium text-foreground">Link to Sheets</span> (the green
              Sheets icon) to open the responses spreadsheet.
            </li>
            <li>Copy the spreadsheet URL from the address bar and paste it below.</li>
          </ol>
          <div className="flex gap-2">
            <Input
              aria-label="Google Sheets link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              disabled={!googleConnected}
            />
            <Button
              variant="outline"
              onClick={loadTabs}
              disabled={busy !== false || !url || !googleConnected}
            >
              {busy === "tabs" ? <Loader2 className="size-4 animate-spin" /> : "Load tabs"}
            </Button>
          </div>
        </div>
      </Step>

      {/* Step 3 — pick a tab and create */}
      <Step n={3} title="Choose a tab and create the dataset" state={step3State} last>
        {tabs ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
              <Label id="tab-label" className="text-[12px] text-muted-foreground">
                Tab
              </Label>
              <Select value={tab} onValueChange={setTab}>
                <SelectTrigger aria-labelledby="tab-label">
                  <SelectValue placeholder="Choose a tab" />
                </SelectTrigger>
                <SelectContent>
                  {tabs.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={create} disabled={busy !== false || !tab} className="w-fit gap-2">
              {busy === "create" && <Loader2 className="size-4 animate-spin" />}
              Create dataset
              <ArrowRight className="size-4" />
            </Button>
            <p className="text-[12px] text-muted-foreground">
              Row 1 becomes the header. New form responses append automatically.
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            Load a sheet above to pick a tab.
          </p>
        )}
      </Step>
    </div>
  );
}
