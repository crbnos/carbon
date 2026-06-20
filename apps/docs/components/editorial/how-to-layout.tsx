"use client";

import type { ReactNode } from "react";
import { PageFeedback } from "@/components/api/page-feedback";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
import { ReadingProgress } from "@/components/reading-progress";
import { chaptersInFlow, useGuide } from "./guide-context";
import { SidebarNav } from "./sidebar-nav";

function FooterChevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d={dir === "left" ? "M8.5 3.5L5 7l3.5 3.5" : "M5.5 3.5L9 7l-3.5 3.5"}
        stroke="rgba(38,35,35,0.55)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Prev/next chapter card — mirrors the ContentFooter cards, but switches chapter via goTo. */
function ChapterCard({ dir, title, onSelect }: { dir: "prev" | "next"; title: string; onSelect: () => void }) {
  const next = dir === "next";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-center gap-[10px] rounded-[12px] border border-[#E7E7E3] bg-[rgba(251,251,248,0.6)] px-[16px] py-[12px] text-left shadow-[inset_0_1px_0_#fff] transition-colors hover:border-[#D9D9D3] hover:bg-[rgba(255,255,255,0.7)] ${
        next ? "flex-row-reverse text-right" : ""
      }`}
    >
      <FooterChevron dir={next ? "right" : "left"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-[family-name:var(--font-mono)] text-[10.5px] font-[600] uppercase tracking-[0.08em] text-[rgba(38,35,35,0.72)]">
          {next ? "Next" : "Previous"}
        </span>
        <span className="truncate text-[15px] font-[560] text-ink-ui transition-colors group-hover:text-[#262323]">
          {title}
        </span>
      </span>
    </button>
  );
}

function PanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.2" stroke="rgba(38,35,35,0.5)" strokeWidth="1.3" />
      <path d="M6.25 3v10" stroke="rgba(38,35,35,0.5)" strokeWidth="1.3" />
    </svg>
  );
}

/** Mobile-only context bar — takes the slot the flow subnav holds on desktop. Shows
 *  where you are (chapter / current section, the section tracking the scrollspy) and
 *  opens the nav drawer, so the whole guide is one tap away without a row of chips. */
function MobileContextBar({ chapter, section }: { chapter: string; section?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("carbon:open-mobile-nav"))}
      className="fixed inset-x-0 top-[64px] z-[55] flex h-[52px] items-center min-[1000px]:hidden"
      style={{ background: "#F5F5F2", borderBottom: "1px solid #E8E7E6", boxShadow: "0 1px 0 0 #fff" }}
    >
      {/* sr-only prefix keeps the visible flow/title text in the accessible name (Label in Name). */}
      <span className="sr-only">Open contents: </span>
      <span className="mx-auto flex w-full max-w-[1440px] items-center gap-[11px] px-[24px]">
        <PanelIcon />
        <span className="min-w-0 flex-1 truncate text-left text-[14px] font-[460] tracking-[0.15px] text-ink-ui">
          <span className={section ? "text-ink-faint" : undefined}>{chapter}</span>
          {section ? (
            <>
              <span className="mx-[7px] text-[rgba(38,35,35,0.3)]">/</span>
              {section}
            </>
          ) : null}
        </span>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
          <path
            d="M3.5 5.5L7 9l3.5-3.5"
            stroke="rgba(38,35,35,0.45)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r="5.25" stroke="rgba(38,35,35,0.42)" strokeWidth="1.2" />
      <path
        d="M7 4.2V7l1.9 1.15"
        stroke="rgba(38,35,35,0.42)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HowToLayout({ bodies }: { bodies: ReactNode[] }) {
  const { active, goTo, chapters } = useGuide();

  const currentChapter = chapters[active.chapter];
  if (!currentChapter) return null;

  // Chapters of the current flow (with global indices) for the mobile selector and
  // the "read next" link — navigation stays within a flow, never spilling into the next.
  const flowChapters = chaptersInFlow(chapters, currentChapter.flow);
  const posInFlow = flowChapters.findIndex((c) => c.index === active.chapter);
  const prevInFlow = flowChapters[posInFlow - 1];
  const nextInFlow = flowChapters[posInFlow + 1];

  return (
    <main className="min-h-screen bg-[#FBFBF9]" style={{ paddingTop: "116px" }}>
      <MobileContextBar chapter={currentChapter.title} section={currentChapter.items[active.item]?.title} />
      <div className="mx-auto flex w-full max-w-[1440px] px-[20px]">
        {/* Sidebar (desktop) — sticky, self-start so it tracks the page scroll instead
            of stretching; scrolls internally only if it outgrows the viewport. */}
        <aside className="sticky top-[116px] hidden max-h-[calc(100dvh-116px)] w-[260px] shrink-0 self-start overflow-y-auto scrollbar-hidden-until-scroll nav-scroll-fade pb-[40px] pl-[50px] pr-[10px] pt-[40px] min-[1000px]:block">
          <SidebarNav chapters={chapters} active={active} onActiveChange={goTo} />
          <NavScrollChevron />
        </aside>

        {/* Content — natural document flow. The window scrolls, so the footer only
            appears once the reader reaches the true end of the chapter. The big left
            indent eases off at xl, where the right-rail TOC fills that space instead. */}
        <div className="min-w-0 flex-1 pb-[80px] pt-[28px] min-[640px]:pl-[32px] min-[640px]:pb-[120px] min-[640px]:pt-[44px] min-[1000px]:pl-[130px] min-[1000px]:pr-[20px] xl:pl-[80px] xl:pr-[40px]">
          <div className="max-w-[620px]">
            <div className="flex flex-wrap items-center gap-[12px]">
              <span
                className="inline-flex items-center justify-center whitespace-nowrap rounded-[100px] px-[8px] py-[4px] font-[family-name:var(--font-mono)] text-[12px] font-medium leading-[16px] text-[rgba(38,35,35,0.72)]"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(251, 251, 248, 0.50) 0%, rgba(251, 251, 248, 0.00) 100%)",
                  boxShadow:
                    "0 0 0 1px #FFF inset, 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 2px 0 rgba(0, 0, 0, 0.02)",
                }}
              >
                {currentChapter.label} — {currentChapter.slug.toUpperCase()}
              </span>
              <span className="inline-flex items-center gap-[5px] font-[family-name:var(--font-mono)] text-[12px] leading-[16px] text-[rgba(38,35,35,0.42)]">
                <ClockIcon />
                {currentChapter.readingTime} min read
              </span>
            </div>

            <h1 className="mt-[18px] text-[32px] font-normal leading-[112%] text-ink md:text-[40px]">
              {currentChapter.title}
            </h1>

            {/* MDX body for the active chapter */}
            {bodies[active.chapter]}

            {/* Footer — feedback + within-flow prev/next, matching the docs pages. */}
            <footer className="mt-[64px] border-t border-[rgba(38,35,35,0.12)] pt-[26px]">
              <PageFeedback key={active.chapter} variant="editorial" />
              {(prevInFlow || nextInFlow) && (
                <nav className="mt-[22px] grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                  <div>
                    {prevInFlow && (
                      <ChapterCard
                        dir="prev"
                        title={prevInFlow.chapter.title}
                        onSelect={() => goTo({ chapter: prevInFlow.index, item: 0 })}
                      />
                    )}
                  </div>
                  <div>
                    {nextInFlow && (
                      <ChapterCard
                        dir="next"
                        title={nextInFlow.chapter.title}
                        onSelect={() => goTo({ chapter: nextInFlow.index, item: 0 })}
                      />
                    )}
                  </div>
                </nav>
              )}
            </footer>
          </div>
        </div>

        {/* Right-rail reading-progress ruler (≥xl). Stretches with the row so the
            sticky ruler inside tracks scroll; the left sidebar keeps section nav. */}
        <aside className="hidden w-[72px] shrink-0 justify-end pl-[16px] xl:flex">
          <ReadingProgress />
        </aside>
      </div>
    </main>
  );
}
