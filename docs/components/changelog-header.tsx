// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Link from "next/link";
import { ChangelogSubscribe } from "@/components/changelog-subscribe";

function RssIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-4">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.5 3a.5.5 0 0 1 .5-.5h.5c5.523 0 10 4.477 10 10v.5a.5.5 0 0 1-.5.5h-.5a.5.5 0 0 1-.5-.5v-.5A8.5 8.5 0 0 0 3.5 4H3a.5.5 0 0 1-.5-.5V3Zm0 4.5A.5.5 0 0 1 3 7h.5A5.5 5.5 0 0 1 9 12.5v.5a.5.5 0 0 1-.5.5H8a.5.5 0 0 1-.5-.5v-.5a4 4 0 0 0-4-4H3a.5.5 0 0 1-.5-.5v-.5Zm0 5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z"
      />
    </svg>
  );
}

/* Page header on Linear's pattern: the title left-aligned at the top, a row beneath it
 * carrying the blurb and the actions, then a full-width rule. The header spans a wider
 * container than the entry column, which stays centred below it. */
export function ChangelogHeader() {
  return (
    <header className="mx-auto w-full max-w-[80rem] px-6 pt-14 lg:px-8 lg:pt-20">
      {/* Actions ride the title row at every width: one Subscribe instance rather than a
          mobile/desktop pair, which would mount two popovers. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-5">
        <h1 className="m-0 text-ed-32 font-light leading-[1.05] tracking-[-0.03em] text-ed-ink sm:text-ed-40">
          Changelog
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* Direct link to the raw feed, next to the subscribe options. */}
          <Link
            href="/changelog/rss.xml"
            aria-label="RSS feed"
            title="RSS feed"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-ed-hairline bg-[#F5F5F2] text-ink-faint no-underline transition-colors hover:border-ed-warm-400 hover:text-ink-ui"
          >
            <RssIcon />
          </Link>
          <ChangelogSubscribe />
        </div>
      </div>
      <p className="m-0 mt-5 max-w-[34rem] pb-6 text-ed-16 leading-relaxed text-ink-body">
        New features, improvements, and fixes across the ERP and the shop floor.
      </p>
      <div className="h-px w-full bg-ed-hairline" />
    </header>
  );
}
