import type { Metadata } from "next";
import { SITE, absolute } from "./site";

// ════════════════════════════════════════════════════════════════════════════
// Page metadata, built once.
//
// Every public page calls `pageMeta()`. It produces the four things that decide
// whether a page ranks and whether a shared link looks like anything:
//
//   title        — 50–60 chars. Longer and Google truncates it mid-word.
//   description  — 150–160 chars. It doesn't affect ranking; it decides the CLICK.
//   canonical    — which URL is THE url. Without it, /page and /page?ref=x and
//                  /page/ are three pages competing with each other, and Google
//                  picks a winner you didn't choose.
//   og + twitter — the card. A page without one gets a grey box in Slack.
//
// The OG image is generated per page from the title, by /og. So every page's card
// is different without anybody opening a design tool.
// ════════════════════════════════════════════════════════════════════════════

export function pageMeta({
  title,
  titleAbsolute,
  description,
  path,
  kicker,
  noindex,
}: {
  /** WITHOUT the site name — the layout's template appends it. */
  title: string;
  /** An exact <title>, bypassing the "— SWAMP" template. Use for a brand-first
   *  home title like "SWAMP: Collaborative database" without doubling the brand. */
  titleAbsolute?: string;
  description: string;
  /** Absolute path from the root, e.g. "/security". */
  path: string;
  /** Small label on the OG card. Defaults to the site name. */
  kicker?: string;
  /** Auth pages, thank-you pages, anything with no reason to be in an index. */
  noindex?: boolean;
}): Metadata {
  const url = absolute(path);

  const ogImage = absolute(
    `/og?title=${encodeURIComponent(title)}&kicker=${encodeURIComponent(kicker ?? SITE.name)}`
  );

  // The card title: the absolute one if given, else "<title> — SWAMP".
  const cardTitle = titleAbsolute ?? `${title} — ${SITE.name}`;

  return {
    title: titleAbsolute ? { absolute: titleAbsolute } : title,
    description,

    // The single most under-used tag in the whole spec.
    alternates: { canonical: url },

    ...(noindex
      ? { robots: { index: false, follow: false } }
      : {
          robots: {
            index: true,
            follow: true,
            googleBot: {
              index: true,
              follow: true,
              // Let Google use a full-size image and a long snippet. The defaults
              // are conservative and cost you SERP real estate for nothing.
              "max-image-preview": "large",
              "max-snippet": -1,
              "max-video-preview": -1,
            },
          },
        }),

    openGraph: {
      type: "website",
      url,
      siteName: SITE.name,
      title: cardTitle,
      description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },

    twitter: {
      card: "summary_large_image",
      title: cardTitle,
      description,
      images: [ogImage],
      ...(SITE.twitter ? { creator: SITE.twitter } : {}),
    },
  };
}
