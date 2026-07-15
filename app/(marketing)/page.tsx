import { Landing, FAQ_ITEMS } from "@/features/marketing/components/landing";
import { pageMeta } from "@/shared/seo/metadata";
import { JsonLd, faqSchema, softwareSchema } from "@/shared/seo/jsonld";
import { SITE } from "@/shared/seo/site";

// The title is the target phrase, not the brand. "SWAMP — Home" ranks for nobody;
// "The shared database your team can actually use" ranks for what people type.
export const metadata = pageMeta({
  // Shown in search results / OG cards (keyword-led).
  title: SITE.tagline,
  // Shown in the browser tab (brand-led, still keyword-bearing). This is the exact
  // <title>, so it doesn't get "— SWAMP" appended.
  titleAbsolute: "SWAMP: Collaborative database for teams",
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
