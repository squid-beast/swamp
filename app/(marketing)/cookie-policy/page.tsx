import type { Metadata } from "next";
import { LegalPage } from "@/features/marketing/components/legal-page";

export const metadata: Metadata = { title: "Cookie Policy — SWAMP" };

export default function CookiePolicyPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated="July 2026"
      intro="SWAMP uses a small number of cookies to keep you signed in and to remember preferences."
      sections={[
        {
          heading: "Essential cookies",
          body: "We set session cookies so you stay signed in as you move around the app. Without these, authentication cannot work.",
        },
        {
          heading: "Preferences",
          body: "We store your theme (light or dark) and sidebar state so the interface looks the way you left it. These stay on your device.",
        },
        {
          heading: "No ad tracking",
          body: "We do not use advertising or cross-site tracking cookies.",
        },
        {
          heading: "Managing cookies",
          body: "You can clear cookies from your browser at any time. Removing the session cookie signs you out.",
        },
      ]}
    />
  );
}
