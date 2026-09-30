import type { Metadata } from "next";
import { ChangelogFeed } from "@/components/changelog-feed";
import { ChangelogHeader } from "@/components/changelog-header";
import { pageSeo } from "@/lib/seo";

const DESCRIPTION =
  "New features, improvements, and fixes across the Carbon ERP and the shop floor.";

export const metadata: Metadata = {
  ...pageSeo({
    title: "Changelog · Carbon",
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
  return (
    <>
      <ChangelogHeader />
      <ChangelogFeed />
    </>
  );
}
