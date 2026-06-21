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
      className="flex flex-wrap items-center font-[family-name:var(--font-mono)] text-[12.5px] leading-[16px]"
    >
      {items.map((c, i) => (
        <Fragment key={`${c.label}-${i}`}>
          {i > 0 && (
            <span aria-hidden="true" className="px-[7px] text-[rgba(38,35,35,0.3)]">
              /
            </span>
          )}
          {c.href ? (
            <Link
              href={c.href}
              className="text-[rgba(38,35,35,0.5)] no-underline transition-colors hover:text-[#262323]"
            >
              {c.label}
            </Link>
          ) : (
            <span className="text-[rgba(38,35,35,0.72)]">{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
