import type { Metadata } from "next";
import Link from "next/link";
import { MainHeader } from "@/components/main-header";

export const metadata: Metadata = {
  title: "Page not found — Carbon",
  description: "The page you’re looking for doesn’t exist or has moved."
};

const LINKS = [
  {
    label: "Guides",
    desc: "Hands-on tours of the core flows",
    href: "/guides/order"
  },
  {
    label: "Reference",
    desc: "Concepts, methods, and platform docs",
    href: "/docs"
  },
  {
    label: "API",
    desc: "REST resources for every table and view",
    href: "/api-reference"
  },
  { label: "MCP", desc: "Connect AI clients to your data", href: "/mcp" }
];

function Arrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0 -translate-x-[2px] text-ed-ink/38 transition-all duration-200 group-hover:translate-x-0 group-hover:text-ed-ink"
    >
      <path
        d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function NotFound() {
  return (
    <div className="min-h-screen w-full bg-ed-paper pt-16">
      <MainHeader />
      <main className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-180 flex-col items-center justify-center px-6 pb-25 text-center">
        <p className="font-mono text-ed-12 font-semibold uppercase tracking-[0.18em] text-ed-ink/50">
          Error 404
        </p>

        {/* Ghosted numeral behind the headline for depth — the type-forward editorial look. */}
        <div className="relative mt-3 flex items-center justify-center">
          <span
            aria-hidden
            className="pointer-events-none absolute select-none font-semibold leading-none text-[180px] text-ed-ink/5 sm:text-[240px]"
          >
            404
          </span>
          <h1 className="relative m-0 text-[clamp(34px,6vw,52px)] font-normal leading-[110%] text-ink">
            This page isn’t here
          </h1>
        </div>

        <p className="mt-5 max-w-115 text-ed-16 leading-[165%] text-ed-ink/70">
          The link may be broken or the page may have moved. Jump back into the
          docs below, or press{" "}
          <kbd className="inline-flex items-center rounded-[5px] border border-ed-warm-300 bg-ed-warm-100 px-[5px] py-px font-mono text-ed-12 text-ed-ink/55">
            ⌘K
          </kbd>{" "}
          to search everything.
        </p>

        <div className="mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group flex items-center justify-between gap-3 rounded-xl border border-ed-hairline bg-ed-paper px-[18px] py-[15px] text-left no-underline shadow-[inset_0_1px_0_#fff] transition-colors hover:border-ed-warm-400 hover:bg-white"
            >
              <span className="min-w-0">
                <span className="block text-ed-15 font-semi text-ink">
                  {l.label}
                </span>
                <span className="mt-[3px] block text-ed-13 leading-normal text-ed-ink/60">
                  {l.desc}
                </span>
              </span>
              <Arrow />
            </Link>
          ))}
        </div>

        <Link
          href="/guides/order"
          className="group relative mt-9 inline-flex h-11 items-center justify-center rounded-lg px-5 no-underline"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
          />
          <span className="text-on-dark relative z-10 text-ed-14 font-book tracking-[0.15px]">
            Back to the guide
          </span>
        </Link>
      </main>
    </div>
  );
}
