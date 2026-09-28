import type { ReactNode } from "react";

/* Card grid for SDK/language choices — brand-icon tile, name, one-line
 * description, arrow CTA. Data-driven: the page supplies the cards (the Client
 * SDKs page feeds it the generator languages), this file owns only the visual. */

/** A simple-icons brand glyph (filled path on a 24×24 viewBox). */
export function Brand({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function Tile({ glyph, tone }: { glyph: ReactNode; tone: string }) {
  return (
    <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg ${tone}`}>
      {glyph}
    </span>
  );
}

function Arrow() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      className="transition-transform group-hover:translate-x-0.5"
    >
      <path
        d="M3 7h8M7.5 3.5L11 7l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface SdkCard {
  glyph: ReactNode;
  /** Tile background/foreground classes, e.g. `bg-[#E8F0FB] text-[#3178C6]`. */
  tone: string;
  name: string;
  desc: string;
  href: string;
  cta: string;
}

export function SdkCardGrid({ cards }: { cards: SdkCard[] }) {
  return (
    <div className="mt-[18px] grid grid-cols-1 gap-3.5 sm:grid-cols-2">
      {cards.map((c) => (
        <a
          key={c.name}
          href={c.href}
          className="group rounded-xl border border-ed-hairline bg-white p-4 no-underline transition-colors hover:border-ed-warm-400"
        >
          <div className="flex items-center gap-[11px]">
            <Tile glyph={c.glyph} tone={c.tone} />
            <span className="text-ed-15 font-semi text-ed-ink">{c.name}</span>
          </div>
          <p className="m-0 mt-2.5 text-ed-14 leading-[160%] text-ed-ink/74">{c.desc}</p>
          <span className="mt-3 inline-flex items-center gap-[5px] text-ed-13 font-medium text-ed-brand-ink">
            {c.cta} <Arrow />
          </span>
        </a>
      ))}
    </div>
  );
}
