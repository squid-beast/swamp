"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, Sparkles, Table2, UploadCloud } from "lucide-react";
import { createClient } from "@/shared/supabase/client";
import type { NavBase } from "@/features/tables/nav";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";

// The workspace home: a greeting and your bases.
//
// Everything that used to be here — the money card, the Stripe balance, the agent
// metrics — belonged to a personal CRM bolted onto the side of the app. It's gone.

const SUBTITLES = [
  "Ready when you are.",
  "A calm home for messy data.",
  "What are we untangling today?",
  "Dump it in, get a table.",
  "Small steps, big swamp.",
];

function greetWord(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Overview({
  firstName,
  userId,
  needsProfile,
  bases,
}: {
  firstName: string;
  userId: string;
  needsProfile: boolean;
  bases: NavBase[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState(firstName);
  const [mounted, setMounted] = React.useState(false);
  const [sub, setSub] = React.useState("");
  const [profileOpen, setProfileOpen] = React.useState(needsProfile);

  // The greeting is time-of-day and therefore local. Computing it on the server
  // means a user in Sydney gets told "Good evening" at 9am — so compute it after
  // mount and fade it in.
  React.useEffect(() => {
    setMounted(true);
    setSub(SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)]);
  }, []);

  const hello = mounted ? `${greetWord()}${name ? `, ${name}` : ""}` : "";
  const empty = bases.length === 0;

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div
        className={cn(
          "flex flex-col gap-1 transition-opacity duration-500",
          mounted ? "opacity-100" : "opacity-0"
        )}
      >
        <h1 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">
          {hello}
        </h1>
        <p className="text-[14px] text-muted-foreground">{sub}</p>
      </div>

      {empty ? (
        <div className="mt-10 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <Sparkles className="size-6 text-brand" />
          <p className="text-[14px] font-medium">No bases yet</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Import a CSV, Excel file or JSON payload. SWAMP types every column and
            gives you a table.
          </p>
          <Button asChild className="mt-1 gap-2">
            <Link href="/app/import">
              <UploadCloud className="size-3.5" />
              Import data
            </Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {bases.map((base) => (
            <div key={base.id} className="rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-brand" />
                <h2 className="truncate font-medium">{base.name}</h2>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {base.tables.length} {base.tables.length === 1 ? "table" : "tables"}
                </span>
              </div>

              <div className="mt-3 flex flex-col gap-0.5">
                {base.tables.slice(0, 5).map((t) => (
                  <Link
                    key={t.id}
                    href={`/app/t/${t.id}`}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted"
                  >
                    <Table2 className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{t.name}</span>
                  </Link>
                ))}
                {base.tables.length === 0 && (
                  <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
                    No tables yet
                  </p>
                )}
              </div>

              <Button asChild variant="ghost" size="sm" className="mt-2 gap-1.5">
                <Link href={`/app/import?baseId=${base.id}`}>
                  <UploadCloud className="size-3.5" />
                  Add a table
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}

      <ProfileGate
        open={profileOpen}
        userId={userId}
        onDone={(first) => {
          setName(first);
          setProfileOpen(false);
          router.refresh();
        }}
      />
    </main>
  );
}

// Blocking: no close button. SWAMP addresses you by name everywhere, and an app
// that calls you "there" is worse than one that asks once.
function ProfileGate({
  open,
  userId,
  onDone,
}: {
  open: boolean;
  userId: string;
  onDone: (first: string) => void;
}) {
  const [first, setFirst] = React.useState("");
  const [last, setLast] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const canSave = !!first.trim() && !!last.trim();

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);

    const { error } = await createClient().from("profiles").upsert({
      id: userId,
      first_name: first.trim(),
      last_name: last.trim(),
      updated_at: new Date().toISOString(),
    });

    setSaving(false);
    if (error) return toast.error(error.message);
    onDone(first.trim());
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="[&>button]:hidden sm:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Complete your profile</DialogTitle>
          <DialogDescription>Add your name so SWAMP can greet you properly.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pg-first" className="text-[12px] text-muted-foreground">
              First name
            </Label>
            <Input
              id="pg-first"
              autoFocus
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pg-last" className="text-[12px] text-muted-foreground">
              Last name
            </Label>
            <Input
              id="pg-last"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
