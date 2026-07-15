"use client";

import * as React from "react";
import { Analytics } from "@vercel/analytics/react";
import { readConsent, type Consent } from "@/features/marketing/components/cookie-consent";

// Mounts Vercel Analytics only when the visitor has opted into the Analytics
// cookie category. Starts off (SSR + first paint), then reads localStorage and
// listens for consent changes so Accept/Reject takes effect without a reload.

export function ConsentAnalytics() {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    const sync = (consent: Consent | null) => {
      setEnabled(!!consent?.analytics);
    };

    sync(readConsent());

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Consent>).detail;
      sync(detail ?? readConsent());
    };
    window.addEventListener("swamp:consent-changed", onChange);
    return () => window.removeEventListener("swamp:consent-changed", onChange);
  }, []);

  if (!enabled) return null;
  return <Analytics />;
}
