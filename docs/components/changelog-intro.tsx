import Link from "next/link";
import { ChangelogDecoration } from "@/components/changelog-decoration";
import { ChangelogSubscribe } from "@/components/changelog-subscribe";

function RssIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3.5 shrink-0" aria-hidden="true">
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0" aria-hidden="true">
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v18H6.5A2.5 2.5 0 0 0 4 19.5Z" />
      <path d="M9 3v14" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="size-3.5 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </svg>
  );
}

const FOOTER_LINKS = [
  { label: "RSS", href: "/changelog/rss.xml", icon: RssIcon },
  { label: "Reference", href: "/docs", icon: BookIcon },
  { label: "Guides", href: "/guides/order", icon: CompassIcon },
];

/* The standing identity column. Its block is optically centred in the viewport with the
 * links pinned to the foot, so the column reads as composed rather than top-weighted.
 * "Changelog" is the eyebrow, not the page heading — the feed carries an sr-only <h1>
 * and an entry page keeps its title as <h1>. */
export function ChangelogIntro() {
  return (
    <div className="relative flex flex-col pt-10 pb-8 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:pt-0 lg:pb-10">
      <ChangelogDecoration />

      <div className="relative z-10 max-w-84 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
        <Link
          href="/changelog"
          className="font-mono text-ed-11 uppercase tracking-[0.1em] text-ink-faint no-underline transition-colors hover:text-ink-ui"
        >
          Changelog
        </Link>
        <h2 className="m-0 mt-4 text-ed-32 font-normal leading-[1.15] tracking-[-0.02em] text-ed-ink">
          What&rsquo;s new in Carbon
          <span className="block text-ed-brand-ink">as it ships</span>
        </h2>
        <p className="m-0 mt-5 text-ed-15 font-book leading-relaxed text-ink-faint">
          Features, improvements, and fixes across the ERP and the shop floor.
        </p>
        <div className="mt-7">
          <ChangelogSubscribe />
        </div>
      </div>

      <div className="relative z-10 mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 lg:mt-0">
        {FOOTER_LINKS.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex items-center gap-1.5 text-ed-13 font-book text-ink-faint no-underline transition-colors hover:text-ink-ui"
          >
            <Icon />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
