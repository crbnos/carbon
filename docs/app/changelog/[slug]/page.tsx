// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChangelogSection } from "@/components/changelog-section";
import { ChangelogTag } from "@/components/changelog-timeline";
import { getMDXComponents } from "@/components/mdx";
import { formatChangelogDate } from "@/lib/changelog";
import { pageSeo } from "@/lib/seo";
import { changelogSource, getChangelogEntries } from "@/lib/source";

type Params = { params: Promise<{ slug: string }> };

/* A single entry reads as an article, not as one row of the feed: no timeline rail, a
 * wider measure and a larger type scale than the summary it came from. */
export default async function ChangelogEntryPage(props: Params) {
  const { slug } = await props.params;
  const page = changelogSource.getPage([slug]);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article className="mx-auto w-full max-w-[46rem] px-6 pt-10 pb-8 lg:px-8">
      <a
        href="/changelog"
        className="inline-flex items-center gap-1.5 text-ed-14 font-book text-ink-faint no-underline transition-colors hover:text-ink-ui"
      >
        <span aria-hidden="true">←</span>
        Changelog
      </a>

      <time
        dateTime={page.data.date}
        className="mt-10 block text-ed-14 font-medium tabular-nums text-ink-faint"
      >
        {formatChangelogDate(page.data.date)}
      </time>

      <h1 style={{ viewTransitionName: `title-${slug}` }} className="m-0 mt-3 font-display text-ed-40 font-semibold leading-[1.12] tracking-[-0.025em] text-ed-ink">
        {page.data.title}
      </h1>

      {page.data.tags.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          {page.data.tags.map((tag) => (
            <ChangelogTag key={tag}>{tag}</ChangelogTag>
          ))}
        </div>
      )}

      {page.data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.data.image}
          alt=""
          width={1200}
          height={675}
          style={{ viewTransitionName: `hero-${slug}` }}
          className="mt-9 aspect-video w-full rounded-xl bg-[#09090B] object-cover ring-1 ring-ed-ink/10 ring-inset"
        />
      )}

      {/* `.guide-prose` (global.css) is the site's long-form reading rhythm: 17px at 1.75.
          It was defined for the Guide and had no call sites; an entry page wants exactly
          it, rather than a second size override competing with `.prose`. */}
      <div className="prose guide-prose mt-10">
        <MDX components={getMDXComponents({ Accordion: ChangelogSection })} />
      </div>

      <div className="mt-14 border-t border-ed-hairline pt-6">
        <a
          href="/changelog"
          className="inline-flex items-center gap-1.5 text-ed-14 text-ed-brand-ink no-underline transition-colors hover:text-ed-ink"
        >
          <span aria-hidden="true">←</span>
          Back to the changelog
        </a>
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
    title: `${page.data.title} · Carbon Changelog`,
    ogTitle: page.data.title,
    description: page.data.description,
    path: page.url,
    eyebrow: "Changelog",
  });
}
