"use client";

import Link from "next/link";
import { useGuide } from "./guide-context";

function Divider() {
  return (
    <span className="relative mx-[7px] self-center shrink-0 w-[1px] h-[16px] translate-y-[4px]">
      <span
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(32,32,32,0.18) 50%, transparent 100%)",
        }}
      />
    </span>
  );
}

export function SiteHeader() {
  const { active, goTo, chapters } = useGuide();

  return (
    <header
      className="site-header fixed top-0 left-0 right-0 z-[201] flex justify-center"
      style={{
        background: "#F5F5F2",
        borderBottom: "1px solid",
        borderColor: "#E8E7E6",
        boxShadow: "0 1px 0 0 #fff",
      }}
    >
      <div className="w-full max-w-[1440px] mx-auto px-[20px] min-[476px]:px-[32px] md:px-[20px] py-[18px] min-[1000px]:py-0 min-[1000px]:pt-[26px] min-[1000px]:pb-[23px] flex items-center justify-between">
        {/* Logo */}
        <Link className="shrink-0 flex items-center gap-[10px] no-underline" aria-label="Home" href="/">
          <img src="/carbon-mark-light.svg" alt="" width={22} height={22} className="block" />
          <span className="hidden min-[480px]:inline text-ink-ui text-[16px] font-[580] tracking-[0.16px]">
            Carbon
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden min-[1000px]:block">
          <nav className="flex items-center gap-3">
            <div className="relative flex h-[41px] items-center pl-[14px] pr-[10px] rounded-[8px]">
              <span className="group relative inline-flex items-center justify-center rounded-[4px] py-[2px] px-[5px] pointer-events-none">
                <span
                  className="nav-link relative z-10 no-underline whitespace-nowrap px-[6px] text-[15px] leading-[150%] tracking-[0.15px] font-[460] cursor-default"
                  style={{ color: "rgba(32, 32, 32, 0.40)" }}
                >
                  How to
                </span>
              </span>

              {chapters.map((chapter) => {
                const isActive = active.chapter === chapter.index;
                return (
                  <span className="contents" key={chapter.slug}>
                    <Divider />
                    <span className="group relative inline-flex items-center justify-center rounded-[4px] py-[2px] px-[5px]">
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 rounded-[4px] transition-opacity duration-200 ease-out ${
                          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        } bg-[rgba(231,231,227,0.80)]`}
                      />
                      <a
                        className="nav-link relative z-10 no-underline whitespace-nowrap px-[6px] text-[15px] leading-[150%] tracking-[0.15px] transition-[color,font-weight] duration-200 ease-in-out text-ink-ui font-[460]"
                        href={`/guides/${chapter.slug}`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          goTo({ chapter: chapter.index, item: 0 });
                        }}
                      >
                        {chapter.slug.charAt(0).toUpperCase() + chapter.slug.slice(1)}
                      </a>
                    </span>
                  </span>
                );
              })}
            </div>

            {/* Reference (Fumadocs surface) */}
            <div className="relative flex h-[41px] items-center justify-center px-[8px] rounded-[8px]">
              <span className="relative inline-flex items-center justify-center rounded-[4px] py-[2px] px-[5px] group">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[4px] bg-[rgba(231,231,227,0.80)] transition-opacity duration-200 ease-out opacity-0 group-hover:opacity-100"
                />
                <Link
                  className="nav-link relative z-10 no-underline whitespace-nowrap px-[6px] text-[15px] leading-[150%] tracking-[0.15px] text-ink-ui font-[460]"
                  href="/docs"
                >
                  Reference
                </Link>
              </span>
            </div>

            {/* CTA */}
            <a
              className="group relative inline-flex items-center justify-center no-underline whitespace-nowrap cursor-pointer h-[41px] px-3 rounded-[8px] w-[140px]"
              href="https://app.carbon.ms"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[8px] cta-btn-dark opacity-100"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[8px] btn-dark-hover opacity-0 duration-200 ease-out group-hover:opacity-100 transition-opacity"
              />
              <span className="relative z-10 inline-flex items-center justify-center gap-[6px]">
                <span className="font-[460] text-[15px] tracking-[0.15px] text-on-dark">Open Carbon</span>
              </span>
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
