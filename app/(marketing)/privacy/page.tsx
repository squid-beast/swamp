import type { Metadata } from "next";
import { LegalPage } from "@/features/marketing/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy — SWAMP" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="July 2026"
      intro="This policy explains what SWAMP collects, why, and the choices you have."
      sections={[
        {
          heading: "What we collect",
          body: "Your account details (name, email, date of birth), any data you import into your datasets, and basic technical logs needed to run and secure the service.",
        },
        {
          heading: "How we use it",
          body: "To authenticate you, store and render your datasets, and keep the service working and secure. Your imported data is scoped to your account and is not shared with other users.",
        },
        {
          heading: "Where it lives",
          body: "Accounts and data are stored with our infrastructure provider (Supabase / Postgres). Access is restricted at the database level so each account can only reach its own rows.",
        },
        {
          heading: "Third parties",
          body: "If you sign in with Google, Google shares your name and email with us to create your profile. We do not sell your personal data.",
        },
        {
          heading: "Your choices",
          body: "You can edit your profile at any time and request deletion of your account and data by contacting us. Deleting your account removes your datasets.",
        },
        {
          heading: "Contact",
          body: "Privacy questions can be sent to hello@swamp.app.",
        },
      ]}
    />
  );
}
