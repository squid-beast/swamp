import { LegalPage } from "@/features/marketing/components/legal-page";
import { pageMeta } from "@/shared/seo/metadata";

export const metadata = pageMeta({
  title: "Privacy Policy",
  description:
    "What SWAMP collects, why, and the choices you have. Your data is scoped to your account by row-level security and is never sold.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="July 2026"
      path="/privacy"
      intro="This policy explains what SWAMP collects, why, and the choices you have."
      sections={[
        {
          heading: "What we collect",
          body: "Your account details (name, email), any data you import into your bases and tables, and basic technical logs needed to run and secure the service.",
        },
        {
          heading: "How we use it",
          body: "To authenticate you, store and render your bases, and keep the service working and secure. Your data is scoped to your account and the people you invite — it is not shared with other users.",
        },
        {
          heading: "Where it lives",
          body: "Accounts and data are stored with our infrastructure provider (Supabase / Postgres). Access is restricted at the database level, row by row, so each account can only reach the rows it's entitled to.",
        },
        {
          heading: "Third parties",
          body: "If you sign in with Google, Google shares your name and email with us to create your profile. We do not sell your personal data.",
        },
        {
          heading: "Your choices",
          body: "You can edit your profile at any time, export any view to CSV or XLSX, and request deletion of your account and data by contacting us. Deleting your account removes your bases.",
        },
        {
          heading: "Contact",
          body: "Privacy questions can be sent to hello@swampy.app.",
        },
      ]}
    />
  );
}
