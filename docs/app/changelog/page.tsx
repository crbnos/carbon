import type { Metadata } from "next";
import { ChangelogFeed } from "@/components/changelog-feed";
import { pageSeo } from "@/lib/seo";

const DESCRIPTION =
  "What's new in Carbon. Every entry is dated, not versioned, and ships the moment it merges.";

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

export default function ChangelogPage() {
  return <ChangelogFeed />;
}
