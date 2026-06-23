"use client";

import { useEffect, useRef } from "react";
import { chaptersInFlow, type GuideChapter } from "./guide-context";

/** Walk up to the nearest actually-scrollable ancestor (the sticky sidebar's overflow
 *  container) so we can scroll *it* without nudging the window. */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

interface SidebarNavProps {
  chapters: GuideChapter[];
  active: { chapter: number; item: number };
  onActiveChange: (pos: { chapter: number; item: number }) => void;
}

// Show only the active flow's chapters; `chapterIdx` stays the GLOBAL index so it
// keeps addressing the right body/scroll position in the flat chapter list.
export function SidebarNav({ chapters, active, onActiveChange }: SidebarNavProps) {
  const activeFlow = chapters[active.chapter]?.flow;
  const visible = activeFlow ? chaptersInFlow(chapters, activeFlow) : [];

  const activeRef = useRef<HTMLButtonElement>(null);

  // Follow the scrollspy: when the highlighted item sits outside the sidebar's own
  // scroll viewport, glide it back in — scrolling only the sidebar, never the page.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    const scroller = getScrollParent(el);
    if (!scroller) return;
    const er = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const PAD = 28;
    if (er.top < sr.top + PAD) {
      scroller.scrollTo({ top: scroller.scrollTop - (sr.top + PAD - er.top), behavior: "smooth" });
    } else if (er.bottom > sr.bottom - PAD) {
      scroller.scrollTo({ top: scroller.scrollTop + (er.bottom - sr.bottom + PAD), behavior: "smooth" });
    }
  }, [active.chapter, active.item]);

  return (
    <nav className="flex flex-col gap-10">
      {visible.map(({ chapter, index: chapterIdx }) => (
        <div key={chapter.slug}>
          <div className="relative flex items-center">
            <span className="absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 font-mono text-ed-12 font-medium text-ink-faint leading-[140%] tracking-[0.12px] whitespace-nowrap">
              {chapter.label}
            </span>
            <span className="text-ed-ink/80 text-ed-15 font-demi leading-[140%] tracking-[0.15px]">
              {chapter.title}
            </span>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {chapter.items.map((item, itemIdx) => {
              const isActive = active.chapter === chapterIdx && active.item === itemIdx;
              return (
                <button
                  key={item.id}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onActiveChange({ chapter: chapterIdx, item: itemIdx })}
                  className="flex gap-3.5 text-left cursor-pointer bg-transparent border-none p-0 items-center"
                >
                  <div
                    className={`w-2 h-2 rounded-[5.5px] shrink-0 transition-all duration-200 ${
                      isActive
                        ? "bg-ed-blue-bg-strong shadow-[0_1px_1px_0_rgba(0,126,183,0.70),inset_0_0.5px_0.2px_0_#FFF,0_0_0_3px_#96DEFF]"
                        : "bg-ed-warm-100 shadow-[0_1px_1px_0_rgba(0,0,0,0.25),0_0_0_3px_rgba(213,213,211,0.50),inset_0_0.5px_0.2px_0_#FFF]"
                    }`}
                  />
                  <span className="text-ed-graphite/80 text-ed-15 font-book leading-[140%] tracking-[0.15px] whitespace-pre-line">
                    {item.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
