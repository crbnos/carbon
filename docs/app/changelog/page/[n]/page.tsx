import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChangelogFeed } from "@/components/changelog-feed";
import { changelogPagePath, paginateChangelog } from "@/lib/changelog";
import { pageSeo } from "@/lib/seo";
import { getChangelogEntries } from "@/lib/source";

type Params = { params: Promise<{ n: string }> };

/** Parse `/changelog/page/N`. Page 1 lives at `/changelog` and is not
 *  duplicated here; anything else out of range is a 404. */
function pageNumber(n: string): number | null {
  if (!/^\d+$/.test(n)) return null;
  const page = Number(n);
  const { pageCount } = paginateChangelog(getChangelogEntries(), 1);
  return page >= 2 && page <= pageCount ? page : null;
}

export default async function ChangelogPagedPage(props: Params) {
  const { n } = await props.params;
  const page = pageNumber(n);
  if (page === null) notFound();
  return <ChangelogFeed page={page} />;
}

export function generateStaticParams() {
  const { pageCount } = paginateChangelog(getChangelogEntries(), 1);
  return Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => ({
    n: String(i + 2)
  }));
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { n } = await props.params;
  const page = pageNumber(n);
  if (page === null) notFound();
  return pageSeo({
    title: `Changelog — page ${page} — Carbon`,
    ogTitle: "Changelog",
    description: "Older entries from the Carbon changelog.",
    path: changelogPagePath(page),
    eyebrow: "Changelog"
  });
}
