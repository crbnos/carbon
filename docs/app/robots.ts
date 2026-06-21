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
