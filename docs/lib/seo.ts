import type { Metadata } from "next";

/**
 * Canonical site origin — the host these docs are actually served from, used as
 * `metadataBase` in the root layout. It MUST be the docs subdomain, not the
 * marketing root (`carbon.ms`): relative URLs (the `/og` card, canonicals) resolve
 * against this, and `carbon.ms` is a separate app with no working `/og` route, so
 * pointing here at the root would make every shared link's embed image 404/500.
 */
export const SITE = {
  url: "https://docs.carbon.ms",
  name: "Carbon",
} as const;

/**
 * Central, hand-written SEO copy — the one place to edit titles + descriptions.
 * Minimal and concrete; no filler. Per-resource / per-tool / per-doc copy still
 * comes from that page's own data — this covers the site, the surfaces, and the
 * guides (where a chapter should read as its guide, not a stray sentence).
 */
export const SEO = {
  site: {
    title: "Carbon Docs",
    description:
      "Docs for Carbon — the manufacturing system. ERP for the office, MES for the floor.",
  },
  api: {
    intro: {
      title: "API reference",
      description: "Carbon's REST API — every table and view is an endpoint.",
    },
    auth: {
      title: "API authentication",
      description: "Create a scoped API key, send it as a bearer token.",
    },
  },
  mcp: {
    intro: {
      title: "MCP server",
      description: "Connect Carbon to Claude, Cursor, and other AI clients over MCP.",
    },
    auth: {
      title: "MCP authentication",
      description: "Authenticate MCP clients with OAuth or a scoped API key.",
    },
    tools: {
      title: "MCP tools",
      description: "1,200+ tools, reached through one lean discovery pattern.",
    },
  },
  // Per-guide blurb, keyed by flow slug — shared by every chapter of that guide.
  guides: {
    "make-to-order": {
      description: "Follow one order from the sales desk to a shipped, traceable robot.",
    },
    "quote-to-cash": {
      description: "From quote to sales order to cash in the bank.",
    },
    "rfq-to-bill": {
      description: "From RFQ to purchase order to a matched supplier bill.",
    },
    "manufacturing-accounting": {
      description: "How a job costs out and posts to the ledger.",
    },
  } as Record<string, { description: string }>,
};

/** Descriptor for the dynamic OG image of a page, resolved against `metadataBase`. */
export function ogImage(opts: { title: string; eyebrow?: string }) {
  const params = new URLSearchParams({ title: opts.title });
  if (opts.eyebrow) params.set("eyebrow", opts.eyebrow);
  return { url: `/og?${params.toString()}`, width: 1200, height: 630, alt: opts.title };
}

/**
 * Per-page SEO: a self-referencing canonical plus Open Graph + Twitter cards that
 * share one dynamic OG template (`/og`). `title` is the full <title> (it may carry a
 * surface suffix like "— Carbon API"); `ogTitle` is the cleaner line drawn on the card.
 */
export function pageSeo(opts: {
  title: string;
  description?: string;
  path: string;
  eyebrow?: string;
  ogTitle?: string;
}): Metadata {
  const image = ogImage({ title: opts.ogTitle ?? opts.title, eyebrow: opts.eyebrow });
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url: opts.path,
      type: "article",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [image.url],
    },
  };
}
