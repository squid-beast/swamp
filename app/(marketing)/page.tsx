import { Landing, FAQ_ITEMS } from "@/features/marketing/components/landing";
import { pageMeta } from "@/shared/seo/metadata";
import { JsonLd, faqSchema, softwareSchema } from "@/shared/seo/jsonld";
import { SITE } from "@/shared/seo/site";

// The title is the target phrase, not the brand. "SWAMP — Home" ranks for nobody;
// "The shared database your team can actually use" ranks for what people type.
export const metadata = pageMeta({
  title: SITE.tagline,
  description: SITE.description,
  path: "/",
  kicker: "Collaborative database",
});

export default function HomePage() {
  return (
    <>
      {/* The product, and the FAQ — the FAQ block is legitimate because these exact
          questions are rendered on the page below, visible to a person. */}
      <JsonLd data={softwareSchema()} />
      <JsonLd data={faqSchema(FAQ_ITEMS.map(({ q, a }) => ({ q, a })))} />
      <Landing />
    </>
  );
}
