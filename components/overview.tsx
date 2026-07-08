"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Kanban, UploadCloud, LayoutGrid } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SUBTITLES = [
  "Ready when you are.",
  "Coffee first, then chaos.",
  "Note it down before it slips.",
  "A calm home for messy data.",
  "What are we untangling today?",
  "Dump it in, get a UI.",
  "Small steps, big swamp.",
  "Let's make something out of the mess.",
];

function greetWord(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Overview({
  firstName,
  userId,
  needsProfile,
  onboarded,
}: {
  firstName: string;
  userId: string;
  needsProfile: boolean;
  onboarded: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(firstName);
  const [mounted, setMounted] = React.useState(false);
  const [sub, setSub] = React.useState("");
  const [profileOpen, setProfileOpen] = React.useState(needsProfile);
  const [onboardOpen, setOnboardOpen] = React.useState(!needsProfile && !onboarded);

  // Greeting is time-of-day + local, so compute it on the client after mount to
  // avoid a server/client (timezone) mismatch; fade it in.
  React.useEffect(() => {
    setMounted(true);
    setSub(SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)]);
  }, []);

  const onProfileDone = (first: string) => {
    setName(first);
    setProfileOpen(false);
    if (!onboarded) setOnboardOpen(true);
    router.refresh(); // update the sidebar/header name
  };

  const closeOnboarding = React.useCallback(() => {
    setOnboardOpen(false);
    void createClient().from("profiles").update({ onboarded: true }).eq("id", userId);
  }, [userId]);

  const hello = mounted ? `${greetWord()}${name ? `, ${name}` : ""}` : "";

  return (
    <main className="flex min-h-[calc(100vh-9rem)] flex-col items-center justify-center p-6 text-center">
      <div
        className={cn(
          "flex flex-col items-center gap-2.5 transition-opacity duration-500",
          mounted ? "opacity-100" : "opacity-0"
        )}
      >
        <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">{hello}</h1>
        <p className="text-[15px] text-muted-foreground">{sub}</p>
      </div>

      <ProfileGate open={profileOpen} userId={userId} onDone={onProfileDone} />
      <OnboardingDialog open={onboardOpen} onClose={closeOnboarding} />
    </main>
  );
}

// Blocking: no close button, can't dismiss until a name is entered.
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

const STEPS = [
  {
    icon: Sparkles,
    title: "Welcome to SWAMP",
    body: "A calm home for your tasks and data. Here's the 20-second tour.",
  },
  {
    icon: Kanban,
    title: "Track work on boards",
    body: "Open the Kanban Board to create columns and cards — plan tasks and drag them across stages.",
  },
  {
    icon: UploadCloud,
    title: "Turn data into a UI",
    body: "Import a CSV or Excel file, or connect a Google Sheet — SWAMP types every column and builds the views for you.",
  },
  {
    icon: LayoutGrid,
    title: "You're all set",
    body: "Your datasets and boards live in the sidebar. Jump in whenever you like.",
  },
];

function OnboardingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = React.useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <step.icon className="size-6" />
          </div>
          <DialogTitle className="text-center">{step.title}</DialogTitle>
          <DialogDescription className="text-center">{step.body}</DialogDescription>
        </div>
        <div className="flex justify-center gap-1.5 py-1">
          {STEPS.map((_, j) => (
            <span
              key={j}
              className={cn("size-1.5 rounded-full transition-colors", j === i ? "bg-brand" : "bg-muted")}
            />
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
            Skip
          </Button>
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="outline" size="sm" onClick={() => setI(i - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <Button size="sm" onClick={onClose}>
                Get started
              </Button>
            ) : (
              <Button size="sm" onClick={() => setI(i + 1)}>
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
