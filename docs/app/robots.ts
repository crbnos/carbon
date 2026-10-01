// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    // Allow everything except internal endpoints (search, OG generation).
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/og"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url
  };
}
