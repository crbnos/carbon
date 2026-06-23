import type { MetadataRoute } from "next";
import { allResourceParams } from "@/lib/api-data";
import { SITE } from "@/lib/seo";
import { guideSource, source } from "@/lib/source";
import { allToolParams } from "@/lib/tools-data";

/** Every canonical, indexable URL on the docs site. `/` is intentionally omitted —
 *  it rewrites to /guides/order, which is listed as its own canonical entry. */
export default function sitemap(): MetadataRoute.Sitemap {
  const abs = (path: string) => `${SITE.url}${path}`;
  const out: MetadataRoute.Sitemap = [];

  // Editorial Guide
  for (const page of guideSource.getPages()) {
    out.push({ url: abs(page.url), changeFrequency: "monthly", priority: 0.8 });
  }

  // Reference docs (platform + product reference + building)
  for (const page of source.getPages()) {
    out.push({ url: abs(page.url), changeFrequency: "monthly", priority: 0.7 });
  }

  // REST API reference
  out.push({
    url: abs("/api-reference"),
    changeFrequency: "monthly",
    priority: 0.6
  });
  out.push({
    url: abs("/api-reference/authentication"),
    changeFrequency: "yearly",
    priority: 0.5
  });
  for (const { module, resource } of allResourceParams()) {
    out.push({
      url: abs(`/api-reference/${module}/${resource}`),
      changeFrequency: "monthly",
      priority: 0.5
    });
  }

  // MCP
  out.push({ url: abs("/mcp"), changeFrequency: "monthly", priority: 0.6 });
  out.push({
    url: abs("/mcp/authentication"),
    changeFrequency: "yearly",
    priority: 0.5
  });
  out.push({
    url: abs("/mcp/tools"),
    changeFrequency: "monthly",
    priority: 0.5
  });
  for (const { tool } of allToolParams()) {
    out.push({
      url: abs(`/mcp/tools/${tool}`),
      changeFrequency: "monthly",
      priority: 0.4
    });
  }

  return out;
}
