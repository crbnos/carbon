import { describe, expect, it } from "vitest";
import {
  displayDate,
  entryEmailContent,
  parseChangelogFeed,
  planDispatch,
  unescapeXml
} from "./feed";

// The exact shape docs/app/changelog/rss.xml/route.ts emits.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Carbon Changelog</title>
    <link>https://docs.carbon.ms/changelog</link>
    <atom:link href="https://docs.carbon.ms/changelog/rss.xml" rel="self" type="application/rss+xml" />
    <description>What&apos;s new in Carbon.</description>
    <language>en</language>
    <item>
      <title>Finite-capacity scheduling</title>
      <link>https://docs.carbon.ms/changelog/2026-09-04-finite-capacity-scheduling</link>
      <guid isPermaLink="true">https://docs.carbon.ms/changelog/2026-09-04-finite-capacity-scheduling</guid>
      <pubDate>04 Sep 2026 00:00:00 GMT</pubDate>
      <description>Capacity-aware scheduling &amp; an explainable Gantt.</description>
      <category>production</category>
      <category>settings</category>
    </item>
    <item>
      <title>Accounting sync for Xero, QuickBooks, and Rillet</title>
      <link>https://docs.carbon.ms/changelog/2026-08-18-accounting-sync-engine</link>
      <guid isPermaLink="true">https://docs.carbon.ms/changelog/2026-08-18-accounting-sync-engine</guid>
      <pubDate>18 Aug 2026 00:00:00 GMT</pubDate>
      <category>accounting</category>
    </item>
  </channel>
</rss>`;

describe("parseChangelogFeed", () => {
  it("parses every item, preserving feed (newest-first) order", () => {
    const entries = parseChangelogFeed(FEED);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      guid: "https://docs.carbon.ms/changelog/2026-09-04-finite-capacity-scheduling",
      title: "Finite-capacity scheduling",
      link: "https://docs.carbon.ms/changelog/2026-09-04-finite-capacity-scheduling",
      description: "Capacity-aware scheduling & an explainable Gantt.",
      pubDate: "04 Sep 2026 00:00:00 GMT",
      tags: ["production", "settings"]
    });
    expect(entries[1]?.description).toBeNull();
    expect(entries[1]?.tags).toEqual(["accounting"]);
  });

  it("returns [] for a feed with no items", () => {
    expect(
      parseChangelogFeed(FEED.replace(/<item>[\s\S]*<\/item>/, ""))
    ).toEqual([]);
  });

  it("skips items missing guid, title, or link", () => {
    const broken = FEED.replace(
      '<guid isPermaLink="true">https://docs.carbon.ms/changelog/2026-09-04-finite-capacity-scheduling</guid>',
      ""
    );
    const entries = parseChangelogFeed(broken);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tags).toEqual(["accounting"]);
  });
});

describe("unescapeXml", () => {
  it("round-trips the five escaped entities", () => {
    expect(unescapeXml("&amp;&lt;&gt;&quot;&apos;")).toBe("&<>\"'");
  });
});

describe("entryEmailContent", () => {
  it("builds the subject and a text alternative carrying the links", () => {
    const { subject, text } = entryEmailContent(
      {
        guid: "g",
        title: "Ship faster",
        link: "https://docs.carbon.ms/changelog/x",
        description: null,
        pubDate: null,
        tags: []
      },
      "https://app.carbon.ms/x/account/notifications"
    );
    expect(subject).toBe("Ship faster");
    expect(text).toContain("Changelog: https://docs.carbon.ms/changelog/x");
    expect(text).toContain(
      "Manage your changelog subscription: https://app.carbon.ms/x/account/notifications"
    );
  });
});

describe("displayDate", () => {
  it("trims the feed pubDate to its day", () => {
    expect(displayDate("04 Sep 2026 00:00:00 GMT")).toBe("04 Sep 2026");
    expect(displayDate(null)).toBeUndefined();
  });
});

describe("planDispatch", () => {
  const entries = parseChangelogFeed(FEED);

  it("bootstraps everything and sends nothing when the ledger is empty", () => {
    const plan = planDispatch(entries, new Set(), true);
    expect(plan.send).toEqual([]);
    expect(plan.bootstrap).toHaveLength(2);
  });

  it("sends only entries missing from a seeded ledger", () => {
    const seeded = new Set([entries[1]?.guid ?? ""]);
    const plan = planDispatch(entries, seeded, false);
    expect(plan.bootstrap).toEqual([]);
    expect(plan.send.map((e) => e.guid)).toEqual([entries[0]?.guid]);
  });
});
