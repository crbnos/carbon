import Link from "next/link";
import { ChangelogSubscribe } from "@/components/changelog-subscribe";
import { getMDXComponents } from "@/components/mdx";
import {
  changelogPagePath,
  formatChangelogDate,
  paginateChangelog
} from "@/lib/changelog";
import { getChangelogEntries } from "@/lib/source";

// Same button chrome as the Subscribe control in the header.
const PAGER_BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg border border-ed-hairline bg-[#F5F5F2] px-3.5 py-2 text-ed-14 font-book text-ink-ui no-underline transition-colors hover:border-[#D8D8D3]";

/** The changelog feed, Linear-style: a date rail on the left (sticky while the
 *  entry scrolls), the entry itself on the right — big title, optional hero
 *  image, prose. Every entry renders in full, newest first, with an anchor
 *  (its slug) and a permalink page. Paged: `/changelog` is page 1, older
 *  entries live at `/changelog/page/N`. */
export function ChangelogFeed({ page }: { page: number }) {
  const { entries, pageCount } = paginateChangelog(getChangelogEntries(), page);

  return (
    <div>
      <header className="flex items-end justify-between gap-4">
        <h1 className="reference-title m-0">Changelog</h1>
        <div className="mb-1">
          <ChangelogSubscribe />
        </div>
      </header>

      <div className="mt-6">
        {entries.map((entry, i) => {
          const MDX = entry.data.body;
          const slug = entry.slugs[entry.slugs.length - 1];
          // The accent node marks the newest entry overall, not the newest on
          // an older page.
          const isLatest = page === 1 && i === 0;
          return (
            <article
              key={entry.url}
              id={slug}
              className="scroll-mt-24 py-10 md:grid md:grid-cols-[8.5rem_1px_minmax(0,1fr)] md:gap-x-8 md:py-0"
            >
              {/* Date rail — sticky on desktop so the date keeps the reader's
                  place through a long entry; a plain row above the title on mobile. */}
              <div className="mb-4 md:mb-0 md:py-14">
                <div className="flex flex-row items-center gap-x-3 gap-y-2.5 md:sticky md:top-24 md:flex-col md:items-end">
                  {/* The timeline node. Absolutely positioned onto the line in the
                      next grid column (2rem gap + half the 1px line, dot is 11px),
                      and INSIDE the sticky block — so it rides down the line with
                      the date while the entry scrolls. The latest entry's node is
                      filled with the accent color; older ones are hollow. */}
                  <span
                    aria-hidden="true"
                    className={`absolute top-[5px] right-[calc(-2rem-6px)] hidden size-[11px] rounded-full border-2 md:block ${
                      isLatest
                        ? "border-[#1E84B0] bg-[#1E84B0] shadow-[0_0_0_4px_rgba(30,132,176,0.16)]"
                        : "border-[#B9B9B4] bg-[#FBFBF9]"
                    }`}
                  />
                  <time
                    dateTime={entry.data.date}
                    className="whitespace-nowrap text-ed-14 font-book text-ink-faint"
                  >
                    {formatChangelogDate(entry.data.date)}
                  </time>
                </div>
              </div>

              {/* Timeline — the middle grid column is a 1px line spanning the
                  entry's full (unpadded) height, so adjacent entries' segments
                  touch and read as one continuous line down the feed. Kept
                  unpositioned so the sticky rail's dot paints above it. */}
              <div className="hidden bg-[#E7E7E3] md:block" aria-hidden="true" />

              <div className="min-w-0 md:py-14">
                <h2 className="m-0 text-[27px] font-demi leading-[1.2] tracking-[-0.02em] text-ink-ui">
                  <Link href={entry.url} className="no-underline hover:underline">
                    {entry.data.title}
                  </Link>
                </h2>
                {entry.data.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entry.data.image}
                    alt={entry.data.title}
                    className="mt-6 w-full rounded-xl border border-ed-hairline bg-[#F5F5F2]"
                  />
                )}
                <div className="prose mt-6">
                  <MDX components={getMDXComponents()} />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {pageCount > 1 && (
        <nav
          aria-label="Changelog pages"
          className="mt-4 flex items-center justify-between gap-4 border-t border-ed-hairline pt-6"
        >
          {page > 1 ? (
            <Link
              href={changelogPagePath(page - 1)}
              className={PAGER_BUTTON}
            >
              <span aria-hidden="true">←</span>
              Newer entries
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ed-14 font-book text-ink-faint">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              href={changelogPagePath(page + 1)}
              className={PAGER_BUTTON}
            >
              Older entries
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
