import type { Metadata } from "next";
import { ChangelogFeed } from "@/components/changelog-feed";
import { pageSeo } from "@/lib/seo";

const DESCRIPTION =
  "What's new in Carbon. Every entry ships the moment it merges — dated, not versioned.";

export const metadata: Metadata = {
  ...pageSeo({
    title: "Changelog — Carbon",
    ogTitle: "Changelog",
    description: DESCRIPTION,
    path: "/changelog",
    eyebrow: "Changelog",
  }),
  alternates: {
    canonical: "/changelog",
    types: { "application/rss+xml": "/changelog/rss.xml" },
  },
};

/** Page 1 of the feed; older pages are `/changelog/page/[n]`. */
export default function ChangelogPage() {
  return <ChangelogFeed page={1} />;
}
