import { SITE, absolute } from "./site";

// ════════════════════════════════════════════════════════════════════════════
// Structured data.
//
// This is the part of SEO that is not a hack. It is a machine-readable statement
// of what the page IS — and it is what puts sitelinks under your result, turns a
// FAQ into an expandable block, and lets Google render a breadcrumb instead of a
// raw URL.
//
// It costs nothing at runtime (a <script> tag of JSON) and it is the difference
// between a plain blue link and a result that takes up four times the space.
//
// Everything below must be TRUE. Marking up a rating you don't have, or an
// organisation that doesn't exist, is the one SEO mistake that gets a manual
// penalty rather than a shrug.
// ════════════════════════════════════════════════════════════════════════════

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // The data is ours, not a user's. Still: JSON.stringify escapes nothing by
      // default, and a `</script>` inside a string would close the tag early.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/** Who publishes this site. Feeds the knowledge panel and the sitelinks. The
 *  `founder` points at the Person below, so the two records reinforce each other. */
export const organizationSchema = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE.url}/#organization`,
  name: SITE.name,
  url: SITE.url,
  description: SITE.description,
  email: SITE.email,
  founder: { "@id": `${SITE.url}/#founder` },
  sameAs: [SITE.github],
});

/**
 * The person who built it.
 *
 * This is the record that makes a search for "Lohith Kumar Neerukonda" resolve to
 * swampy.app: a Person tied to the Organization as its founder, rendered on the
 * About page where the same name is visible in the heading and prose. The photo
 * and the sameAs links give Google something to attach the name to.
 */
export const personSchema = () => ({
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": `${SITE.url}/#founder`,
  name: SITE.founder.name,
  url: `${SITE.url}/about`,
  jobTitle: SITE.founder.role,
  image: absolute(SITE.founder.image),
  worksFor: { "@id": `${SITE.url}/#organization` },
  affiliation: {
    "@type": "Organization",
    name: SITE.founder.company.name,
    url: SITE.founder.company.url,
  },
  sameAs: SITE.founder.sameAs,
});

/** The site itself. The `potentialAction` is what earns a search box in the SERP —
 *  omitted, because we don't have a public search endpoint and claiming one that
 *  404s is worse than not claiming it. */
export const websiteSchema = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE.url}/#website`,
  name: SITE.name,
  url: SITE.url,
  description: SITE.description,
  publisher: { "@id": `${SITE.url}/#organization` },
});

/**
 * The product.
 *
 * No `aggregateRating`, no `offers`. We have no reviews and no published price,
 * and inventing either is the fastest route to a structured-data penalty — the
 * one part of SEO where lying is checked by a human.
 */
export const softwareSchema = () => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE.name,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Database",
  operatingSystem: "Web",
  url: SITE.url,
  description: SITE.description,
  featureList: [
    "Spreadsheet-style grid with keyboard navigation",
    "Kanban, gallery, calendar and form views",
    "Links, lookups, rollups and formulas across tables",
    "Comments and field-level record history",
    "Per-person roles from viewer to owner",
    "Public share links and forms",
    "REST API with scoped tokens",
    "Webhooks",
  ],
});

/** Breadcrumbs. Google renders these INSTEAD of the raw URL, on every page that
 *  has them. Two lines of JSON for a visibly better result. */
export const breadcrumbSchema = (trail: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((crumb, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: crumb.name,
    item: absolute(crumb.path),
  })),
});

/** An FAQ block. Only valid if the questions are ACTUALLY ON THE PAGE, visible to
 *  a human. Marking up answers you don't render is cloaking. */
export const faqSchema = (qa: { q: string; a: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: qa.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});
