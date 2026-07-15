// ════════════════════════════════════════════════════════════════════════════
// The site's shape, in one file.
//
// The nav, the footer AND the sitemap are all generated from this. Add a page
// here and it appears in all three; it cannot exist in the nav and be missing
// from the sitemap, which is the usual way a page ends up un-indexed for a year.
//
// Every link below points at a page that EXISTS. No "Careers" that 404s, no
// "Pricing" we haven't decided, no "Docs" that isn't written. A footer full of
// dead links is worse than a short one — it tells a visitor the product is
// abandoned, and it tells a crawler the same thing.
// ════════════════════════════════════════════════════════════════════════════

type ChangeFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface PublicPage {
  path: string;
  label: string;
  changeFrequency: ChangeFreq;
  /** Relative, not absolute. It says "this page matters more than that one" —
   *  nothing more. Setting everything to 1.0 says nothing at all. */
  priority: number;
}

export const PUBLIC_PAGES: PublicPage[] = [
  { path: "/", label: "Home", changeFrequency: "weekly", priority: 1.0 },
  { path: "/about", label: "About", changeFrequency: "monthly", priority: 0.7 },
  { path: "/security", label: "Security", changeFrequency: "monthly", priority: 0.7 },
  { path: "/privacy", label: "Privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", label: "Terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/cookie-policy", label: "Cookies", changeFrequency: "yearly", priority: 0.3 },
];

/** The top nav. Deliberately three items — a nav with nine is a nav nobody reads. */
export const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#collaboration", label: "Collaboration" },
  { href: "/security", label: "Security" },
] as const;

export const FOOTER_COLUMNS: {
  heading: string;
  links: { label: string; href: string; external?: boolean }[];
}[] = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Collaboration", href: "/#collaboration" },
      { label: "Views", href: "/#views" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "GitHub", href: "https://github.com/squid-beast", external: true },
      { label: "Contact", href: "mailto:hello@swampy.app" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Cookies", href: "/cookie-policy" },
    ],
  },
];
