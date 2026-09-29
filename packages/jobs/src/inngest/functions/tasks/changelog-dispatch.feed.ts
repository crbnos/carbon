// Parses our own changelog feed (docs/app/changelog/rss.xml/route.ts), not RSS
// in general: change this with that route.

type ChangelogFeedEntry = {
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

// Keeps feed order (newest first). Items without a guid, title or link are
// skipped: they cannot be dispatched or ledgered.
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

// An empty ledger means the dispatcher has never run: record every entry
// without sending, or the first run would mail the whole back-catalogue.
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

// "04 Sep 2026 00:00:00 GMT" → "04 Sep 2026".
export function displayDate(pubDate: string | null): string | undefined {
  if (!pubDate) return undefined;
  const day = pubDate.slice(0, 11).trim();
  return day.length > 0 ? day : undefined;
}

// Subject and plain-text part of an entry email; the HTML part is
// ChangelogEntryEmail.
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
