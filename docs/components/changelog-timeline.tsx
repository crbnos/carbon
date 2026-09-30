import type { ReactNode } from "react";
import { ChangelogSpineProgress } from "@/components/changelog-motion";
import { formatChangelogDate } from "@/lib/changelog";

/** The feed, the entry page and the pager all lay out on this one track definition,
 *  so an entry's prose lands exactly where its summary was. */
export const TIMELINE_GRID =
  "md:grid md:grid-cols-[7rem_1px_minmax(0,1fr)] md:gap-x-8";

// A dotted rule rather than a solid hairline — it reads as a timeline, not a table border.
const SPINE_DOTS =
  "bg-[repeating-linear-gradient(to_bottom,#D8D7D2_0px,#D8D7D2_3px,transparent_3px,transparent_7px)]";

/** Grid cells 1 and 2 of {@link TIMELINE_GRID}: the date, its tick into the spine, and
 *  the spine itself. `isLatest` marks the newest entry with a dot where its tick lands. */
export function ChangelogEntryMeta({
  date,
  isLatest,
  progress,
}: {
  date: string;
  isLatest?: boolean;
  /** Fill the spine to scroll depth — reading progress through a single entry. */
  progress?: boolean;
}) {
  return (
    <>
      <div className="mb-4 md:mb-0 md:py-7">
        <div className="relative md:sticky md:top-24 md:text-right">
          <time
            dateTime={date}
            className={`whitespace-nowrap text-ed-12 font-book transition-colors ${
              isLatest ? "text-ed-brand-ink" : "text-ink-faint group-hover:text-ink-ui"
            }`}
          >
            {formatChangelogDate(date)}
          </time>
          <span
            aria-hidden="true"
            className={`absolute top-[8px] right-[-2rem] hidden h-px w-8 transition-colors md:block ${
              isLatest ? "bg-ed-brand-ink" : "bg-ed-svg-line group-hover:bg-ed-ink/40"
            }`}
          />
          {isLatest && (
            <span
              aria-hidden="true"
              className="absolute top-[5px] right-[calc(-2rem-3px)] hidden size-[7px] rounded-full bg-ed-brand-ink shadow-[0_0_0_4px_rgba(30,132,176,0.14)] md:block"
            />
          )}
        </div>
      </div>
      <div className="relative hidden md:block" aria-hidden="true">
        <div className={`absolute inset-0 ${SPINE_DOTS}`} />
        {progress && <ChangelogSpineProgress />}
      </div>
    </>
  );
}

/** A tag chip, on the same mono-badge idiom the editorial Callout badge uses
 *  (`editorial/mdx.tsx`) — so changelog metadata reads like the rest of the site
 *  rather than as a disabled pill. Shared by the feed and the entry page. */
export function ChangelogTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-ed-warm-150 px-1.5 py-0.5 font-mono text-ed-11 leading-5 text-ed-ink/50">
      {children}
    </span>
  );
}
