import type { MetadataRoute } from "next";
import { SITE, absolute } from "@/shared/seo/site";

// robots.txt
//
// The disallows are not about secrecy — robots.txt is public, and a crawler that
// wants in ignores it. They are about CRAWL BUDGET and about not indexing pages
// that should never appear in a search result.
//
// `/app/*` is the product: every one of those pages requires a session, so a
// crawler gets a redirect to sign-in, and Google would index a hundred copies of
// the login screen under a hundred different URLs. `/s/*` is a share link —
// someone's private data behind an unguessable URL, and the fastest way to make
// it public is to let it into an index.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/app/",       // the product. Session-gated: a crawler sees only the login redirect.
          "/api/",       // JSON. Nothing to rank, and it burns crawl budget.
          "/auth/",      // sign-in, register, reset. Never a landing page.
          "/s/",         // public share links — unguessable, and they must stay that way.
          "/invite/",    // single-use tokens.
        ],
      },
    ],
    sitemap: absolute("/sitemap.xml"),
    host: SITE.url,
  };
}
