"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";

// ════════════════════════════════════════════════════════════════════════════
// Cookie consent.
//
// A real, granular manager: a banner on first visit, and a preferences dialog
// with three categories. Essential is always on (auth + security); Analytics and
// Marketing default OFF and are opt-in. Vercel Analytics only mounts after the
// Analytics flag is true (see ConsentAnalytics).
//
// The choice is stored in localStorage under a versioned key, so bumping the
// version re-asks everyone (which is what you do when the categories change). The
// footer's "Cookie settings" button reopens the dialog via a window event.
//
// `readConsent()` is exported so analytics (and anything else) can check the flag
// before loading. Persist also fires `swamp:consent-changed` so listeners can
// react without a reload.
// ════════════════════════════════════════════════════════════════════════════

const KEY = "swamp:consent:v1";

export interface Consent {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  ts: number;
}

export function readConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") as Consent | null;
  } catch {
    return null;
  }
}

export function CookieConsent() {
  // Start "decided" so the server and first client render agree (banner hidden),
  // then flip to showing the banner if no choice is stored. No hydration flash.
  const [decided, setDecided] = React.useState(true);
  const [prefsOpen, setPrefsOpen] = React.useState(false);
  const [analytics, setAnalytics] = React.useState(false);
  const [marketing, setMarketing] = React.useState(false);

  React.useEffect(() => {
    const stored = readConsent();
    if (stored) {
      setAnalytics(!!stored.analytics);
      setMarketing(!!stored.marketing);
    } else {
      setDecided(false);
    }
    const open = () => setPrefsOpen(true);
    window.addEventListener("swamp:cookie-settings", open);
    return () => window.removeEventListener("swamp:cookie-settings", open);
  }, []);

  const persist = (a: boolean, m: boolean) => {
    const consent: Consent = { essential: true, analytics: a, marketing: m, ts: Date.now() };
    try {
      localStorage.setItem(KEY, JSON.stringify(consent));
    } catch {
      /* storage disabled — the choice just won't persist, which is safe */
    }
    setAnalytics(a);
    setMarketing(m);
    setDecided(true);
    setPrefsOpen(false);
    // Let ConsentAnalytics (and anything else) react without a full reload.
    window.dispatchEvent(new CustomEvent("swamp:consent-changed", { detail: consent }));
  };

  const acceptAll = () => persist(true, true);
  const rejectAll = () => persist(false, false);
  const saveChoices = () => persist(analytics, marketing);

  return (
    <>
      {!decided && (
        <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              SWAMP uses essential cookies to keep you signed in. With your say-so, we
              can also use cookies to understand usage. Read the{" "}
              <Link
                href="/cookie-policy"
                className="text-foreground underline-offset-4 hover:underline"
              >
                Cookie Policy
              </Link>
              .
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPrefsOpen(true)}>
                Manage
              </Button>
              <Button variant="outline" size="sm" onClick={rejectAll}>
                Reject all
              </Button>
              <Button size="sm" onClick={acceptAll}>
                Accept all
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cookie preferences</DialogTitle>
            <DialogDescription>
              Choose what SWAMP may store on your device. Essential cookies keep you
              signed in and can&apos;t be switched off.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <PrefRow
              title="Essential"
              desc="Sign-in, security, and your basic preferences. Always on."
              checked
              disabled
            />
            <PrefRow
              title="Analytics"
              desc="Anonymous usage, so we can see what to improve. Off unless you allow it."
              checked={analytics}
              onChange={setAnalytics}
            />
            <PrefRow
              title="Marketing"
              desc="Measuring campaigns. SWAMP sets none today; this stays ready if that changes."
              checked={marketing}
              onChange={setMarketing}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" onClick={rejectAll}>
              Reject all
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={saveChoices}>
                Save choices
              </Button>
              <Button size="sm" onClick={acceptAll}>
                Accept all
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PrefRow({
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange?.(v === true)}
        className="mt-0.5"
        aria-label={title}
      />
      <div className="flex flex-col gap-0.5">
        <p className="text-[13.5px] font-medium leading-none">{title}</p>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
