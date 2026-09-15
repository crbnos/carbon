import { escapeXml, RSS_ITEM_LIMIT, rfc822Date } from "@/lib/changelog";
import { SITE } from "@/lib/seo";
import { getChangelogEntries } from "@/lib/source";

// Rendered once at build time — the feed only changes when an entry merges,
// which redeploys the site.
export const dynamic = "force-static";

export function GET() {
  const items = getChangelogEntries()
    .slice(0, RSS_ITEM_LIMIT)
    .map((entry) => {
      const url = `${SITE.url}${entry.url}`;
      return [
        "    <item>",
        `      <title>${escapeXml(entry.data.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${rfc822Date(entry.data.date)}</pubDate>`,
        entry.data.description
          ? `      <description>${escapeXml(entry.data.description)}</description>`
          : undefined,
        ...entry.data.tags.map(
          (tag) => `      <category>${escapeXml(tag)}</category>`
        ),
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Carbon Changelog</title>
    <link>${SITE.url}/changelog</link>
    <atom:link href="${SITE.url}/changelog/rss.xml" rel="self" type="application/rss+xml" />
    <description>What's new in Carbon — the manufacturing system. ERP for the office, MES for the floor.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
