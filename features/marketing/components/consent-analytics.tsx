"use client";

import * as React from "react";
import { Analytics } from "@vercel/analytics/react";
import { readConsent, type Consent } from "@/features/marketing/components/cookie-consent";

// Mounts Vercel Analytics only when the visitor has opted into the Analytics
// cookie category. Starts off (SSR + first paint), then reads localStorage and
// listens for consent changes so Accept/Reject takes effect without a reload.
//
// TWO gates, not one. Consent is the visitor's; this is the deployment's —
// @vercel/analytics posts to /_vercel/insights, which only exists on Vercel. Off
// it (a VPS, a container) that is a 404 on every page load, collecting nothing.
// Set NEXT_PUBLIC_ANALYTICS=vercel where it works, and leave it unset elsewhere.
const ANALYTICS_AVAILABLE = process.env.NEXT_PUBLIC_ANALYTICS === "vercel";

export function ConsentAnalytics() {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    const sync = (consent: Consent | null) => {
      setEnabled(!!consent?.analytics);
    };

    if (!ANALYTICS_AVAILABLE) return;
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
