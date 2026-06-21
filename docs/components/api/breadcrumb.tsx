import Link from "next/link";
import { Fragment } from "react";

export type Crumb = { label: string; href?: string };

/**
 * Slash-separated trail above a page title — surface → section. The current page is
 * the <h1> beneath it, so the trail stops at the parent (no redundant last crumb).
 * Mono + faint to sit quietly above the heading, matching the doc eyebrows.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center font-mono text-ed-12 leading-4"
    >
      {items.map((c, i) => (
        <Fragment key={`${c.label}-${i}`}>
          {i > 0 && (
            <span aria-hidden="true" className="px-[7px] text-ed-ink/30">
              /
            </span>
          )}
          {c.href ? (
            <Link
              href={c.href}
              className="text-ed-ink/50 no-underline transition-colors hover:text-ed-ink"
            >
              {c.label}
            </Link>
          ) : (
            <span className="text-ed-ink/72">{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
