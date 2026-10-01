// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { formatChangelogDate } from "@/lib/changelog";

/* Centred single column with the date hanging in the left margin, on the pattern Linear
 * and Cloudflare use: the ENTRY column is centred on the page and the date sits outside
 * it, rather than the pair being centred together, which would push the reading column
 * off-centre.
 *
 * The rule is a left border on the entry cell, and the vertical rhythm is PADDING inside
 * that cell rather than margin between articles; that is what keeps the line continuous
 * down the page instead of breaking at every gap.
 *
 * The date only hangs out from `xl`, where there is margin to hang it in. Below that it
 * runs inline above the entry. */
export function ChangelogRow({
  date,
  href,
  children,
}: {
  date: string;
  href: string;
  children: ReactNode;
}) {
  const label = formatChangelogDate(date);
  const time = (className: string) => (
    <time
      dateTime={date}
      className={`whitespace-nowrap text-ed-13 font-medium leading-5 tabular-nums text-ink-faint transition-colors duration-200 group-data-[active]:text-ed-ink ${className}`}
    >
      {label}
    </time>
  );

  return (
    <div className="mx-auto w-full max-w-[42rem] px-6">
      <div className="relative py-10 md:border-l md:border-dashed md:border-ed-warm-500 md:py-14 md:pl-12">
        <a
          href={href}
          className="absolute top-14 right-full mr-10 hidden w-40 text-right no-underline xl:block"
        >
          {time("")}
        </a>

        {/* The node, centred on the rule. */}
        <span className="absolute top-[3.6rem] -left-[7px] hidden size-3.5 md:block">
          <span className="absolute inset-0 rounded-full border-2 border-ed-warm-500 bg-ed-paper transition-[background-color,border-color] duration-200 group-data-[active]:border-ed-brand-ink group-data-[active]:bg-ed-brand-ink" />
          <span className="absolute inset-0 scale-50 rounded-full bg-ed-brand-ink/20 opacity-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[active]:scale-[2.2] group-data-[active]:opacity-100" />
        </span>

        <a href={href} className="mb-5 flex w-fit no-underline xl:hidden">
          {time("")}
        </a>

        {children}
      </div>
    </div>
  );
}

/** A tag chip: quiet metadata, never competing with the title or the action. */
export function ChangelogTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-ed-warm-150 px-2 py-0.5 font-mono text-ed-12 leading-5 text-ed-ink/55">
      {children}
    </span>
  );
}
