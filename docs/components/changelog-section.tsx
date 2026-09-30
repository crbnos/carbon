import type { ReactNode } from "react";

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0" aria-hidden="true">
      <path d="M11 3 12.6 8.4 18 10l-5.4 1.6L11 17l-1.6-5.4L4 10l5.4-1.6z" />
      <path d="M18.5 14.5 19.3 17l2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8z" opacity="0.55" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2.4 2.4 0 0 1-3.4-3.4z" />
      <path d="m17.5 3.5 3 3" />
    </svg>
  );
}

// "Fixes" gets the wrench, anything else the sparkle: the two titles the entries use.
function iconFor(title: string) {
  return /fix/i.test(title) ? <WrenchIcon /> : <SparkleIcon />;
}

/* Replaces <Accordion> inside a changelog entry. A release note's Improvements and Fixes
 * are the substance of the entry, not an aside to be opened, so they render as a plain
 * titled section. The RSS route degrades the same component to an <h3> plus its list, so
 * the page, the feed and the newsletter all show the same thing. */
export function ChangelogSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-ed-hairline pt-6 first:mt-0">
      <h3 className="m-0 flex items-center gap-2 text-ed-15 font-demi text-ed-brand-ink">
        {iconFor(title)}
        <span className="text-ink-ui">{title}</span>
      </h3>
      <div className="[&>ul]:mt-3 [&>ul]:mb-0">{children}</div>
    </section>
  );
}
