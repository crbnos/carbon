"use client";

import type { ReactNode } from "react";
import { PageFeedback } from "@/components/api/page-feedback";
import { EditOnGitHub } from "@/components/edit-on-github";
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
      className={`group flex w-full items-center gap-2.5 rounded-xl border border-ed-hairline bg-ed-paper/60 px-4 py-3 text-left shadow-[inset_0_1px_0_#fff] transition-colors hover:border-ed-warm-400 hover:bg-white/70 ${
        next ? "flex-row-reverse text-right" : ""
      }`}
    >
      <FooterChevron dir={next ? "right" : "left"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-ed-10 font-semibold uppercase tracking-[0.08em] text-ed-ink/72">
          {next ? "Next" : "Previous"}
        </span>
        <span className="truncate text-ed-15 font-semi text-ink-ui transition-colors group-hover:text-ed-ink">
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
      className="fixed inset-x-0 top-16 z-[55] flex h-13 items-center min-[1000px]:hidden"
      style={{ background: "#F5F5F2", borderBottom: "1px solid #E8E7E6", boxShadow: "0 1px 0 0 #fff" }}
    >
      {/* sr-only prefix keeps the visible flow/title text in the accessible name (Label in Name). */}
      <span className="sr-only">Open contents: </span>
      <span className="mx-auto flex w-full max-w-360 items-center gap-[11px] px-6">
        <PanelIcon />
        <span className="min-w-0 flex-1 truncate text-left text-ed-14 font-book tracking-[0.15px] text-ink-ui">
          <span className={section ? "text-ink-faint" : undefined}>{chapter}</span>
          {section ? (
            <>
              <span className="mx-[7px] text-ed-ink/30">/</span>
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
    <main className="min-h-screen bg-ed-paper" style={{ paddingTop: "116px" }}>
      <MobileContextBar chapter={currentChapter.title} section={currentChapter.items[active.item]?.title} />
      <div className="mx-auto flex w-full max-w-360 px-5">
        {/* Sidebar (desktop) — sticky, self-start so it tracks the page scroll instead
            of stretching; scrolls internally only if it outgrows the viewport. */}
        <aside className="sticky top-29 hidden max-h-[calc(100dvh-116px)] w-65 shrink-0 self-start overflow-y-auto scrollbar-hidden-until-scroll nav-scroll-fade pb-10 pl-[50px] pr-2.5 pt-10 min-[1000px]:block">
          <SidebarNav chapters={chapters} active={active} onActiveChange={goTo} />
          <NavScrollChevron />
        </aside>

        {/* Content — natural document flow. The window scrolls, so the footer only
            appears once the reader reaches the true end of the chapter. The big left
            indent eases off at xl, where the right-rail TOC fills that space instead. */}
        <div className="min-w-0 flex-1 pb-20 pt-7 min-[640px]:pl-8 min-[640px]:pb-30 min-[640px]:pt-11 min-[1000px]:pl-[130px] min-[1000px]:pr-5 xl:pl-20 xl:pr-10">
          <div className="max-w-155">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="inline-flex items-center justify-center whitespace-nowrap rounded-full px-2 py-1 font-mono text-ed-12 font-medium leading-4 text-ed-ink/72"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(251, 251, 248, 0.50) 0%, rgba(251, 251, 248, 0.00) 100%)",
                  boxShadow:
                    "0 0 0 1px #FFF inset, 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 2px 0 rgba(0, 0, 0, 0.02)",
                }}
              >
                {currentChapter.label} — {currentChapter.slug.toUpperCase()}
              </span>
              <span className="inline-flex items-center gap-[5px] font-mono text-ed-12 leading-4 text-ed-ink/42">
                <ClockIcon />
                {currentChapter.readingTime} min read
              </span>
            </div>

            <h1 className="mt-[18px] text-ed-32 font-normal leading-[112%] text-ink md:text-ed-40">
              {currentChapter.title}
            </h1>

            {/* MDX body for the active chapter */}
            {bodies[active.chapter]}

            {/* Footer — feedback + edit link, then within-flow prev/next, matching the docs pages. */}
            <footer className="mt-16 border-t border-ed-ink/12 pt-[26px]">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <PageFeedback key={active.chapter} variant="editorial" />
                <EditOnGitHub path={currentChapter.editPath} variant="editorial" />
              </div>
              {(prevInFlow || nextInFlow) && (
                <nav className="mt-[22px] grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <aside className="hidden w-18 shrink-0 justify-end pl-4 xl:flex">
          <ReadingProgress />
        </aside>
      </div>
    </main>
  );
}
