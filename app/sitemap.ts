import type { MetadataRoute } from "next";
import { absolute } from "@/shared/seo/site";
import { PUBLIC_PAGES } from "@/features/marketing/nav";

// The sitemap.
//
// It is generated from the SAME list the nav and footer are built from, so a page
// cannot exist in the site and be missing from the sitemap. Hand-maintaining two
// lists means that, eventually, they disagree — and the one that's wrong is always
// the one nobody looks at.

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: absolute(page.path),
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
