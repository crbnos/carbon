import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangelogSection } from "@/components/changelog-section";
import {
  ChangelogEntryMeta,
  ChangelogTag,
  TIMELINE_GRID,
} from "@/components/changelog-timeline";
import { getMDXComponents } from "@/components/mdx";
import { pageSeo } from "@/lib/seo";
import { changelogSource, getChangelogEntries } from "@/lib/source";

type Params = { params: Promise<{ slug: string }> };

export default async function ChangelogEntryPage(props: Params) {
  const { slug } = await props.params;
  const page = changelogSource.getPage([slug]);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article className={`py-8 md:py-0 ${TIMELINE_GRID}`}>
      <ChangelogEntryMeta date={page.data.date} progress />

      <div className="min-w-0 max-w-160 md:py-7">
        <Link
          href="/changelog"
          className="text-ed-13 font-book text-ink-faint no-underline hover:text-ink-ui"
        >
          ← Changelog
        </Link>
        <h1 className="m-0 mt-5 text-ed-32 font-semi leading-[1.2] tracking-[-0.02em] text-ed-ink">
          {page.data.title}
        </h1>
        {page.data.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {page.data.tags.map((tag) => (
              <ChangelogTag key={tag}>{tag}</ChangelogTag>
            ))}
          </div>
        )}
        {page.data.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.data.image}
            alt={page.data.title}
            className="mt-7 w-full rounded-xl border border-ed-hairline bg-[#F5F5F2]"
          />
        )}
        <div className="prose mt-7">
          <MDX components={getMDXComponents({ Accordion: ChangelogSection })} />
        </div>
        <div className="mt-12 border-t border-ed-hairline pt-6">
          <Link
            href="/changelog"
            className="text-ed-14 text-ed-brand-ink no-underline hover:underline"
          >
            ← All changelog entries
          </Link>
        </div>
      </div>
    </article>
  );
}

export function generateStaticParams() {
  return getChangelogEntries().map((entry) => ({
    slug: entry.slugs[entry.slugs.length - 1],
  }));
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { slug } = await props.params;
  const page = changelogSource.getPage([slug]);
  if (!page) notFound();

  return pageSeo({
    title: `${page.data.title} — Carbon Changelog`,
    ogTitle: page.data.title,
    description: page.data.description,
    path: page.url,
    eyebrow: "Changelog",
  });
}
