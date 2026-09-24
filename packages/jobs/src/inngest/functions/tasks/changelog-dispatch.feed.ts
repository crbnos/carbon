/**
 * Parsing + rendering for the changelog subscription pipeline. Pure — no
 * Inngest, no DB, no env — so it is unit-tested directly (feed.test.ts).
 *
 * The XML it parses is OUR OWN feed (docs/app/changelog/rss.xml/route.ts), so
 * this is a targeted parser for that exact, fully-escaped shape — not a general
 * RSS reader. If the feed route ever changes shape, change this with it.
 */

export type ChangelogFeedEntry = {
  guid: string;
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  tags: string[];
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'"
};

export function unescapeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  const text = match?.[1];
  return text !== undefined ? unescapeXml(text.trim()) : null;
}

/** Feed order is preserved (our feed is newest-first). Items missing a guid,
 *  title, or link are skipped — they cannot be dispatched or ledgered. */
export function parseChangelogFeed(xml: string): ChangelogFeedEntry[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const entries: ChangelogFeedEntry[] = [];
  for (const item of items) {
    const guid = tagText(item, "guid");
    const title = tagText(item, "title");
    const link = tagText(item, "link");
    if (!guid || !title || !link) continue;
    const tags = (item.match(/<category>[\s\S]*?<\/category>/g) ?? []).map(
      (c) => unescapeXml(c.replace(/<\/?category>/g, "").trim())
    );
    entries.push({
      guid,
      title,
      link,
      description: tagText(item, "description"),
      pubDate: tagText(item, "pubDate"),
      tags
    });
  }
  return entries;
}

/**
 * Decide what a dispatcher run does with the feed. An EMPTY ledger means the
 * pipeline has never run — the right move is to record every existing entry as
 * already-dispatched WITHOUT sending, or the first run after deploy would mail
 * the whole back-catalogue to every subscriber. Only once the ledger is seeded
 * does "in the feed but not in the ledger" mean "new".
 */
export function planDispatch(
  entries: ChangelogFeedEntry[],
  ledgeredGuids: Set<string>,
  ledgerIsEmpty: boolean
): { send: ChangelogFeedEntry[]; bootstrap: ChangelogFeedEntry[] } {
  if (ledgerIsEmpty) return { send: [], bootstrap: entries };
  return {
    send: entries.filter((entry) => !ledgeredGuids.has(entry.guid)),
    bootstrap: []
  };
}

/** "04 Sep 2026 00:00:00 GMT" → "04 Sep 2026" — the feed's RFC 822 pubDate, trimmed
 *  for display. Pure string work; never a JS Date. */
export function displayDate(pubDate: string | null): string | undefined {
  if (!pubDate) return undefined;
  const day = pubDate.slice(0, 11).trim();
  return day.length > 0 ? day : undefined;
}

/**
 * Subject + plain-text alternative for an entry email. The HTML is the
 * `ChangelogEntryEmail` template in `@carbon/documents/email` (rendered in the
 * dispatcher); this is the text part every send carries alongside it.
 */
export function entryEmailContent(
  entry: ChangelogFeedEntry,
  manageUrl: string
): { subject: string; text: string } {
  const description = entry.description ?? "";
  return {
    subject: entry.title,
    text: `${entry.title}\n\n${description}\n\nChangelog: ${entry.link}\n\nManage your changelog subscription: ${manageUrl}`
  };
}
