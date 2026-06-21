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
      className="shrink-0 -translate-x-[2px] text-[rgba(38,35,35,0.38)] transition-all duration-200 group-hover:translate-x-0 group-hover:text-[#262323]"
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
    <div className="min-h-screen w-full bg-[#FBFBF9] pt-[64px]">
      <MainHeader />
      <main className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[720px] flex-col items-center justify-center px-[24px] pb-[100px] text-center">
        <p className="font-[family-name:var(--font-mono)] text-[12.5px] font-[600] uppercase tracking-[0.18em] text-[rgba(38,35,35,0.5)]">
          Error 404
        </p>

        {/* Ghosted numeral behind the headline for depth — the type-forward editorial look. */}
        <div className="relative mt-[12px] flex items-center justify-center">
          <span
            aria-hidden
            className="pointer-events-none absolute select-none font-[600] leading-none text-[180px] text-[rgba(38,35,35,0.05)] sm:text-[240px]"
          >
            404
          </span>
          <h1 className="relative m-0 text-[clamp(34px,6vw,52px)] font-normal leading-[110%] text-ink">
            This page isn’t here
          </h1>
        </div>

        <p className="mt-[20px] max-w-[460px] text-[16px] leading-[165%] text-[rgba(38,35,35,0.7)]">
          The link may be broken or the page may have moved. Jump back into the
          docs below, or press{" "}
          <kbd className="inline-flex items-center rounded-[5px] border border-[#DEDEDA] bg-[#F5F5F2] px-[5px] py-[1px] font-[family-name:var(--font-mono)] text-[12px] text-[rgba(38,35,35,0.55)]">
            ⌘K
          </kbd>{" "}
          to search everything.
        </p>

        <div className="mt-[40px] grid w-full grid-cols-1 gap-[12px] sm:grid-cols-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group flex items-center justify-between gap-[12px] rounded-[12px] border border-[#E7E7E3] bg-[#FBFBF8] px-[18px] py-[15px] text-left no-underline shadow-[inset_0_1px_0_#fff] transition-colors hover:border-[#D9D9D3] hover:bg-white"
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-[560] text-ink">
                  {l.label}
                </span>
                <span className="mt-[3px] block text-[13.5px] leading-[150%] text-[rgba(38,35,35,0.6)]">
                  {l.desc}
                </span>
              </span>
              <Arrow />
            </Link>
          ))}
        </div>

        <Link
          href="/guides/order"
          className="group relative mt-[36px] inline-flex h-[44px] items-center justify-center rounded-[8px] px-[20px] no-underline"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[8px] cta-btn-dark"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[8px] btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
          />
          <span className="text-on-dark relative z-10 text-[14px] font-[460] tracking-[0.15px]">
            Back to the guide
          </span>
        </Link>
      </main>
    </div>
  );
}
