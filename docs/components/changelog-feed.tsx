// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ChangelogActiveEntry } from "@/components/changelog-active-entry";
import { ChangelogRow, ChangelogTag } from "@/components/changelog-timeline";
import { getChangelogEntries } from "@/lib/source";

const FEED_TAG_LIMIT = 3;

/* One continuous timeline, with no pager and no scroll reveal. Entries are summaries, so the
 * whole archive is a short scroll, and every one ships visible in the SSR HTML: a feed
 * that fades itself in as you scroll reads as lag, not polish. */
export function ChangelogFeed() {
  const entries = getChangelogEntries();

  return (
    <>
      <h1 className="sr-only">Changelog</h1>
      <ChangelogActiveEntry />

      {entries.map((entry) => {
        const slug = entry.slugs[entry.slugs.length - 1];
        return (
          <article key={entry.url} id={slug} className="group scroll-mt-24">
            <ChangelogRow date={entry.data.date} href={entry.url}>
              {entry.data.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.data.image}
                  alt=""
                  width={1200}
                  height={675}
                  style={{ viewTransitionName: `hero-${slug}` }}
                  className="mb-7 aspect-video w-full rounded-xl bg-[#09090B] object-cover ring-1 ring-ed-ink/10 ring-inset"
                />
              )}
              <h2 style={{ viewTransitionName: `title-${slug}` }} className="m-0 font-display text-ed-24 font-semibold leading-[1.3] tracking-[-0.015em] text-ed-ink">
                {/* A plain anchor, not next/link: a cross-document navigation is what lets
                    the browser run the view transition. Stretched over the whole row, so
                    anywhere in the entry is clickable. */}
                <a
                  href={entry.url}
                  className="no-underline after:absolute after:inset-0"
                >
                  {entry.data.title}
                </a>
              </h2>
              {entry.data.description && (
                <p className="m-0 mt-3 text-ed-16 leading-relaxed text-ink-body">
                  {entry.data.description}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
                {entry.data.tags.slice(0, FEED_TAG_LIMIT).map((tag) => (
                  <ChangelogTag key={tag}>{tag}</ChangelogTag>
                ))}
                <span className="inline-flex items-center gap-1.5 text-ed-14 font-book text-ed-brand-ink">
                  Read the full entry
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </span>
              </div>
            </ChangelogRow>
          </article>
        );
      })}
    </>
  );
}
