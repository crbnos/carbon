"use client";

import Link from "next/link";
import { useGuide } from "./guide-context";

function Divider() {
  return (
    <span className="relative mx-[7px] self-center shrink-0 w-px h-4 translate-y-1">
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
      <div className="w-full max-w-360 mx-auto px-5 min-[476px]:px-8 md:px-5 py-[18px] min-[1000px]:py-0 min-[1000px]:pt-[26px] min-[1000px]:pb-[23px] flex items-center justify-between">
        {/* Logo */}
        <Link className="shrink-0 flex items-center gap-2.5 no-underline" aria-label="Home" href="/">
          <img src="/carbon-mark-light.svg" alt="" width={22} height={22} className="block" />
          <span className="hidden min-[480px]:inline text-ink-ui text-ed-16 font-semi tracking-[0.16px]">
            Carbon
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden min-[1000px]:block">
          <nav className="flex items-center gap-3">
            <div className="relative flex h-[41px] items-center pl-3.5 pr-2.5 rounded-lg">
              <span className="group relative inline-flex items-center justify-center rounded-sm py-0.5 px-[5px] pointer-events-none">
                <span
                  className="nav-link relative z-10 no-underline whitespace-nowrap px-1.5 text-ed-15 leading-normal tracking-[0.15px] font-book cursor-default"
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
                    <span className="group relative inline-flex items-center justify-center rounded-sm py-0.5 px-[5px]">
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 rounded-sm transition-opacity duration-200 ease-out ${
                          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        } bg-ed-hairline/80`}
                      />
                      <a
                        className="nav-link relative z-10 no-underline whitespace-nowrap px-1.5 text-ed-15 leading-normal tracking-[0.15px] transition-[color,font-weight] duration-200 ease-in-out text-ink-ui font-book"
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
            <div className="relative flex h-[41px] items-center justify-center px-2 rounded-lg">
              <span className="relative inline-flex items-center justify-center rounded-sm py-0.5 px-[5px] group">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-sm bg-ed-hairline/80 transition-opacity duration-200 ease-out opacity-0 group-hover:opacity-100"
                />
                <Link
                  className="nav-link relative z-10 no-underline whitespace-nowrap px-1.5 text-ed-15 leading-normal tracking-[0.15px] text-ink-ui font-book"
                  href="/docs"
                >
                  Reference
                </Link>
              </span>
            </div>

            {/* CTA */}
            <a
              className="group relative inline-flex items-center justify-center no-underline whitespace-nowrap cursor-pointer h-[41px] px-3 rounded-lg w-35"
              href="https://app.carbon.ms"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark opacity-100"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 duration-200 ease-out group-hover:opacity-100 transition-opacity"
              />
              <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
                <span className="font-book text-ed-15 tracking-[0.15px] text-on-dark">Open Carbon</span>
              </span>
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
