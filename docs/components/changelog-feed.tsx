import Link from "next/link";
import { ChangelogReveal } from "@/components/changelog-motion";
import {
  ChangelogEntryMeta,
  ChangelogTag,
  TIMELINE_GRID,
} from "@/components/changelog-timeline";
import { getChangelogEntries } from "@/lib/source";

const FEED_TAG_LIMIT = 3;

// One continuous timeline — no pager. Entries are summaries, so the whole archive is a
// short scroll; the full text of each lives on its own page.
export function ChangelogFeed() {
  const entries = getChangelogEntries();

  return (
    <div>
      <h1 className="sr-only">Changelog</h1>

      <ChangelogReveal>
        {entries.map((entry, i) => {
        const slug = entry.slugs[entry.slugs.length - 1];
        return (
          <article
            key={entry.url}
            id={slug}
            data-reveal
            className={`group relative scroll-mt-24 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] data-pending:translate-y-3 data-pending:opacity-0 border-b border-ed-hairline py-8 last:border-b-0 md:border-b-0 md:py-0 ${TIMELINE_GRID}`}
          >
            <ChangelogEntryMeta date={entry.data.date} isLatest={i === 0} />

            <div className="min-w-0 max-w-144 md:py-7">
              <h2 className="m-0 text-ed-20 font-semi leading-[1.35] tracking-[-0.01em] text-ed-ink">
                {/* Stretched over the whole row, so anywhere in the entry is clickable. */}
                <Link
                  href={entry.url}
                  className="no-underline after:absolute after:inset-0 group-hover:underline"
                >
                  {entry.data.title}
                </Link>
              </h2>
              {entry.data.description && (
                <p className="m-0 mt-2.5 text-ed-16 font-book leading-relaxed text-ink-body">
                  {entry.data.description}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
                {entry.data.tags.slice(0, FEED_TAG_LIMIT).map((tag) => (
                  <ChangelogTag key={tag}>{tag}</ChangelogTag>
                ))}
                <span className="inline-flex items-center gap-1.5 text-ed-14 font-book text-ed-brand-ink">
                  Read entry
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </span>
              </div>
            </div>
          </article>
        );
        })}
      </ChangelogReveal>
    </div>
  );
}
