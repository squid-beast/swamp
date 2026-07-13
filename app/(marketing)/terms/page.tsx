import type { Metadata } from "next";
import { LegalPage } from "@/features/marketing/components/legal-page";

export const metadata: Metadata = { title: "Terms of Use — SWAMP" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="July 2026"
      intro="These terms govern your use of SWAMP. By creating an account or using the service, you agree to them."
      sections={[
        {
          heading: "Your account",
          body: "You are responsible for the data you upload and for keeping your login credentials secure. You must be old enough to form a binding contract in your jurisdiction to use SWAMP.",
        },
        {
          heading: "Your data",
          body: "You keep ownership of everything you import. You grant SWAMP only the permissions needed to store, process, and display your data back to you inside the app.",
        },
        {
          heading: "Acceptable use",
          body: "Do not use SWAMP to store unlawful content, to infringe others' rights, or to attempt to disrupt, reverse-engineer, or overload the service. We may suspend accounts that do.",
        },
        {
          heading: "Availability",
          body: "The service is provided on an as-is basis. We work to keep it available but do not guarantee uninterrupted or error-free operation, and we are not liable for indirect or incidental losses.",
        },
        {
          heading: "Changes",
          body: "We may update these terms as the product evolves. Material changes will be reflected in the date above, and continued use after an update means you accept the revised terms.",
        },
        {
          heading: "Contact",
          body: "Questions about these terms can be sent to hello@swamp.app.",
        },
      ]}
    />
  );
}
