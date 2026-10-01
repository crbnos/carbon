// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createElement } from "react";
import { FEED_COMPONENTS } from "@/lib/changelog-feed-components";
import { escapeXml, RSS_ITEM_LIMIT, rfc822Date } from "@/lib/changelog";
import { SITE } from "@/lib/seo";
import { getChangelogEntries } from "@/lib/source";

// Built once; the feed only changes when an entry merges.
export const dynamic = "force-static";

type ChangelogEntry = ReturnType<typeof getChangelogEntries>[number];

// `description` stays the short summary the dispatcher and the ERP panel read.
async function entryHtml(entry: ChangelogEntry): Promise<string> {
  // Dynamic import: Next rejects a static react-dom/server import in app/.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const MDX = entry.data.body;
  return renderToStaticMarkup(createElement(MDX, { components: FEED_COMPONENTS }));
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

export async function GET() {
  const entries = getChangelogEntries().slice(0, RSS_ITEM_LIMIT);
  const bodies = await Promise.all(entries.map(entryHtml));
  const items = entries
    .map((entry, index) => {
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
        // Last, so the dispatcher's first-match parser never reads a tag from the body.
        `      <content:encoded>${cdata(bodies[index] ?? "")}</content:encoded>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Carbon Changelog</title>
    <link>${SITE.url}/changelog</link>
    <atom:link href="${SITE.url}/changelog/rss.xml" rel="self" type="application/rss+xml" />
    <description>What's new in Carbon, the manufacturing system. ERP for the office, MES for the floor.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
