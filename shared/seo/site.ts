// ════════════════════════════════════════════════════════════════════════════
// One place that knows what this site is.
//
// Every title, every canonical URL, every sitemap entry and every JSON-LD block
// reads from here. The alternative — the URL hardcoded in six files — is how a
// site ends up with `og:url` pointing at localhost in production, which nobody
// notices until a link renders blank in Slack.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The canonical origin. NO trailing slash.
 *
 * This MUST be set in production. Without it, `metadataBase` falls back to
 * localhost and every absolute URL Next generates — canonical, og:image,
 * og:url — points at a machine nobody can reach. Google reads those.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000")
).replace(/\/$/, "");

export const SITE = {
  name: "SWAMP",
  /** Used as the title template suffix. Short, because titles get truncated at ~60. */
  shortName: "SWAMP",

  /**
   * The one sentence. It appears in the <title>, the meta description, the OG
   * card and the JSON-LD, so it is written once and only once.
   */
  tagline: "The shared database your team can actually use",

  description:
    "SWAMP is a collaborative database. Import a spreadsheet and get a real database: tables that link together, live filters, comments, record history, and per-person permissions. Share a view with a link, or collect answers with a form.",

  url: SITE_URL,
  email: "hello@swampy.app",
  github: "https://github.com/squid-beast",

  /**
   * The person behind SWAMP. This feeds the Person JSON-LD and the Organization
   * `founder`, so that a Google search for the name resolves to this site. The
   * photo lives at /public/lohith.jpg — swap that one file to change it everywhere.
   */
  founder: {
    name: "Lohith Kumar Neerukonda",
    role: "Founder & CTO of Ekoham",
    image: "/lohith.jpg",
    linkedin: "https://www.linkedin.com/in/lknnerukonda/",
    company: { name: "Ekoham LLC", url: "https://www.ekohamllc.com/" },

    /** Every profile that is really him. Feeds the Person JSON-LD `sameAs`, which is
     *  how Google ties the name to all of these (and to this site). */
    sameAs: [
      "https://www.linkedin.com/in/lknnerukonda/",
      "https://github.com/squid-beast",
      "https://www.ekohamllc.com/",
      "https://www.voxpilot.io/",
      "https://www.tovu.studio/",
    ],

    /** The portfolio, shown on /about. Blurbs are taken from each site, not invented. */
    ventures: [
      {
        name: "Ekoham",
        url: "https://www.ekohamllc.com/",
        blurb:
          "The parent company. Focused software products and software-enabled services for real-world business workflows.",
      },
      {
        name: "Voxpilot",
        url: "https://www.voxpilot.io/",
        blurb:
          "A software studio building AI receptionists, custom websites, and the automation that keeps calls, leads, and bookings connected.",
      },
      {
        name: "Tovu Studio",
        url: "https://www.tovu.studio/",
        blurb:
          "A booking marketplace for local appointments: find a place, read its page, and reserve a time in minutes.",
      },
    ],
  },

  /** Twitter/X handle, or null. Don't invent one — an @ that doesn't exist is worse
   *  than none, because the card renders with a dead attribution link. */
  twitter: null as string | null,
} as const;

/** Absolute URL for a path. Canonicals and OG tags must be absolute. */
export const absolute = (path: string) =>
  `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
