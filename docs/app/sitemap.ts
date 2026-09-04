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

  // Carbon API (the headline surface — service layer, reached over MCP today)
  out.push({ url: abs("/api"), changeFrequency: "monthly", priority: 0.7 });
  out.push({ url: abs("/api/mcp"), changeFrequency: "monthly", priority: 0.5 });
  out.push({
    url: abs("/api/authentication"),
    changeFrequency: "yearly",
    priority: 0.5
  });
  out.push({
    url: abs("/api/operations"),
    changeFrequency: "monthly",
    priority: 0.5
  });
  for (const { tool } of allToolParams()) {
    out.push({
      url: abs(`/api/operations/${tool}`),
      changeFrequency: "monthly",
      priority: 0.5
    });
  }

  // Data API (PostgREST — the secondary data plane, demoted below the Carbon API)
  out.push({
    url: abs("/api-reference"),
    changeFrequency: "monthly",
    priority: 0.5
  });
  out.push({
    url: abs("/api-reference/authentication"),
    changeFrequency: "yearly",
    priority: 0.4
  });
  for (const { module, resource } of allResourceParams()) {
    out.push({
      url: abs(`/api-reference/${module}/${resource}`),
      changeFrequency: "monthly",
      priority: 0.4
    });
  }

  return out;
}
