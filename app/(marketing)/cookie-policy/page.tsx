import { LegalPage } from "@/features/marketing/components/legal-page";
import { pageMeta } from "@/shared/seo/metadata";

export const metadata = pageMeta({
  title: "Cookie Policy",
  description:
    "SWAMP uses a small number of cookies to keep you signed in and remember preferences. No advertising trackers.",
  path: "/cookie-policy",
});

export default function CookiePolicyPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated="July 2026"
      path="/cookie-policy"
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
          body: "We set no advertising or cross-site tracking cookies. If we ever add privacy-friendly analytics, they stay off until you allow them in Cookie settings.",
        },
        {
          heading: "Managing cookies",
          body: "Use “Cookie settings” in the footer to change your choices at any time. You can also clear cookies from your browser; removing the session cookie signs you out.",
        },
      ]}
    />
  );
}
