import path from "node:path";
import { readCorpus } from "@/lib/markdown-corpus";
import { SITE } from "@/lib/seo";

/* /llms.txt — the llmstxt.org index for AI crawlers and assistants: every page as
 * title + canonical URL + one-line description, grouped by section in sidebar order.
 * The full stripped content lives at /llms-full.txt. Built once at build time. */

export const dynamic = "force-static";

const SECTIONS: { label: string; prefix: string }[] = [
  { label: "Guides", prefix: "guides/" },
  { label: "Product reference", prefix: "docs/reference/" },
  { label: "Building on Carbon", prefix: "docs/building/" },
  { label: "Integrations", prefix: "docs/integrations/" },
  { label: "Platform", prefix: "docs/platform/" },
  { label: "Overview", prefix: "docs/" },
];

export function GET() {
  const pages = readCorpus(path.join(process.cwd(), "content"));

  const line = (p: (typeof pages)[number]) =>
    `- [${p.title}](${SITE.url}/${p.slug.replace(/\/index$/, "")})${
      p.description ? `: ${p.description}` : ""
    }`;

  const used = new Set<string>();
  const sections = SECTIONS.map(({ label, prefix }) => {
    const members = pages.filter(
      (p) => !used.has(p.slug) && (p.slug + "/").startsWith(prefix)
    );
    for (const m of members) used.add(m.slug);
    return members.length
      ? `## ${label}\n\n${members.map(line).join("\n")}`
      : null;
  }).filter(Boolean);

  const body = [
    "# Carbon Docs",
    "> Documentation for Carbon, a manufacturing ERP + MES: editorial guides that tour the flows, a product reference per entity, and platform/self-hosting docs. The full page contents in plain markdown are at " +
      `${SITE.url}/llms-full.txt; the REST API reference is at ${SITE.url}/api.`,
    ...sections,
  ].join("\n\n");

  return new Response(`${body}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
