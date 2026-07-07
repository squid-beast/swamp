"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

  if (!googleConnected) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Connect your Google account so SWAMP can read a sheet. It only requests read-only
          access, and you choose exactly which sheet to import.
        </p>
        <Button onClick={connectGoogle} className="w-fit">
          Connect Google account
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sheet-url">Google Sheets link</Label>
        <div className="flex gap-2">
          <Input
            id="sheet-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
          <Button variant="outline" onClick={loadTabs} disabled={busy !== false || !url}>
            {busy === "tabs" ? <Loader2 className="size-4 animate-spin" /> : "Load tabs"}
          </Button>
        </div>
      </div>

      {tabs && (
        <>
          <div className="flex flex-col gap-2">
            <Label>Tab</Label>
            <Select value={tab} onValueChange={setTab}>
              <SelectTrigger>
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
            Create dataset from this tab
          </Button>
          <p className="text-[12px] text-muted-foreground">
            Row 1 is used as the header. New rows added later append automatically.
          </p>
        </>
      )}
    </div>
  );
}
