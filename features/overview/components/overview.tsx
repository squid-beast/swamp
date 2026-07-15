"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bug, CalendarDays, Database, Plus, Sparkles, Table2, UploadCloud, Users } from "lucide-react";
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

// Client-side card metadata. The actual base is built server-side (see
// features/tables/templates.ts) — this list just drives the buttons.
const TEMPLATE_CARDS = [
  { id: "crm", name: "CRM", desc: "Companies, contacts, and a drag-and-drop deal pipeline.", Icon: Users },
  { id: "content-calendar", name: "Content calendar", desc: "Plan posts across channels, on a calendar and a board.", Icon: CalendarDays },
  { id: "bug-tracker", name: "Bug tracker", desc: "Triage issues by priority and status.", Icon: Bug },
] as const;

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
  const [busy, setBusy] = React.useState<string | null>(null);

  // Create a base from a template (or "blank") and open it. `busy` stays set on
  // success so the buttons don't flicker back to life mid-navigation.
  const create = async (template: string) => {
    if (busy) return;
    setBusy(template);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create the base");
      router.push(`/app/t/${json.tableId}`);
      router.refresh();
    } catch (e) {
      setBusy(null);
      toast.error((e as Error).message);
    }
  };

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
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="size-4 text-brand" />
            <p className="text-[14px] font-medium">Start with a template</p>
          </div>
          <p className="mb-4 text-[13px] text-muted-foreground">
            A ready-made base with example data. Change anything, or start blank.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {TEMPLATE_CARDS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => create(t.id)}
                disabled={!!busy}
                className="flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 disabled:opacity-60"
              >
                <span className="flex size-8 items-center justify-center rounded-lg border bg-background">
                  <t.Icon className="size-4" />
                </span>
                <span className="mt-1 text-[14px] font-medium">{t.name}</span>
                <span className="text-[12.5px] leading-relaxed text-muted-foreground">
                  {t.desc}
                </span>
                {busy === t.id && (
                  <span className="text-[11px] text-muted-foreground">Creating…</span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => create("blank")}
              disabled={!!busy}
              className="gap-2"
            >
              <Plus className="size-3.5" />
              Blank base
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/app/import">
                <UploadCloud className="size-3.5" />
                Import a file
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-muted-foreground">Your bases</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => create("blank")}
              disabled={!!busy}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              New base
            </Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
        </>
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
