import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

type TocLesson = { id: string; text: string };
type TocTopic = { id: string; text: string; lessons: TocLesson[] };

/** "On this page" rail — an outline of the article's `section[id]` topics and,
 *  nested under each, its lesson rows (`[data-toc-lesson]`). Only the topic
 *  carries the blue active state; lessons are quiet jump links. Renders nothing
 *  when the page has no such sections. */
export function OnThisPage() {
  const { pathname } = useLocation();
  const [topics, setTopics] = useState<TocTopic[]>([]);
  const [activeTopic, setActiveTopic] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  // While a click-driven scroll is animating, freeze the scrollspy so it can't
  // override the clicked topic as the page glides past intermediate sections.
  const suppressRef = useRef(false);

  // Keep the active entry visible inside the TOC's own scroll area (like docs) —
  // scrolls only the nav container, never the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when active changes
  useEffect(() => {
    const el = activeRef.current;
    const scroller = navRef.current;
    if (!el || !scroller) return;
    const er = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const PAD = 24;
    if (er.top < sr.top + PAD) {
      scroller.scrollTo({
        top: scroller.scrollTop - (sr.top + PAD - er.top),
        behavior: "smooth"
      });
    } else if (er.bottom > sr.bottom - PAD) {
      scroller.scrollTo({
        top: scroller.scrollTop + (er.bottom - sr.bottom + PAD),
        behavior: "smooth"
      });
    }
  }, [activeTopic]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scan on route change
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("main section[id]")
    );
    const items: TocTopic[] = sections
      .map((section) => ({
        id: section.id,
        text: section.querySelector("h2, h3")?.textContent ?? "",
        lessons: Array.from(
          section.querySelectorAll<HTMLElement>("[data-toc-lesson]")
        )
          .filter((el) => el.id)
          .map((el) => ({ id: el.id, text: el.dataset.tocTitle ?? "" }))
      }))
      .filter((t) => t.text.trim());
    setTopics(items);

    if (sections.length === 0) return;

    // Active topic = the deepest section whose top has scrolled above the
    // reading line (~a third down the viewport, where the eye actually is).
    // At the very bottom of the page the line can't reach the last section,
    // so snap to the final one.
    const recompute = () => {
      if (suppressRef.current) return;
      const line = Math.max(120, window.innerHeight * 0.33);
      const doc = document.documentElement;
      const atBottom =
        window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      let current = sections[0]?.id ?? "";
      if (atBottom) {
        current = sections[sections.length - 1]?.id ?? current;
      } else {
        for (const s of sections) {
          if (s.getBoundingClientRect().top <= line) current = s.id;
          else break;
        }
      }
      setActiveTopic(current);
    };
    recompute();

    const observer = new IntersectionObserver(recompute, {
      rootMargin: "-110px 0px -60% 0px",
      threshold: [0, 1]
    });
    for (const s of sections) observer.observe(s);
    window.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [pathname]);

  // Fully self-driven scroll. Native `#hash` anchors race the SPA router's
  // scroll restoration and browser smooth-scroll support is inconsistent, so:
  // preventDefault, update the hash via replaceState (no router navigation),
  // and animate window.scrollTo with our own rAF ease. A lesson click lights
  // its parent topic.
  const go = (id: string, topicId: string) => (e: MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    suppressRef.current = true;
    setActiveTopic(topicId);
    window.history.replaceState(null, "", `#${id}`);

    // Flash the jumped-to lesson row so the eye lands on it.
    if (el.hasAttribute("data-toc-lesson")) {
      el.classList.remove("lesson-flash");
      void el.offsetWidth; // restart the animation if re-clicked
      el.classList.add("lesson-flash");
      el.addEventListener(
        "animationend",
        () => el.classList.remove("lesson-flash"),
        { once: true }
      );
    }

    const HEADER_OFFSET = 96; // matches the targets' scroll-mt-24
    const startY = window.scrollY;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    const targetY = Math.max(
      0,
      Math.min(el.getBoundingClientRect().top + startY - HEADER_OFFSET, maxY)
    );

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo(0, targetY);
      suppressRef.current = false;
      return;
    }

    const dist = targetY - startY;
    const duration = 420;
    const t0 = performance.now();
    const ease = (t: number) => 1 - (1 - t) ** 3; // easeOutCubic
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, startY + dist * ease(p));
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        suppressRef.current = false;
      }
    };
    requestAnimationFrame(step);
  };

  if (topics.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className="sticky top-24 max-h-[calc(100dvh-120px)] overflow-y-auto pr-2 scrollbar-hidden-until-scroll"
    >
      <p className="mb-3 font-mono text-ed-11 font-semibold uppercase tracking-[0.1em] text-ed-ink/45">
        On this page
      </p>
      <ul className="m-0 flex list-none flex-col border-l border-ed-hairline p-0">
        {topics.flatMap((topic) => {
          const isActive = activeTopic === topic.id;
          return [
            <li key={topic.id} className="-ml-px">
              <a
                ref={isActive ? activeRef : undefined}
                href={`#${topic.id}`}
                onClick={go(topic.id, topic.id)}
                aria-current={isActive ? "location" : undefined}
                className={`block border-l-2 py-1.5 pl-4 text-ed-13 font-demi leading-snug no-underline transition-colors duration-150 ${
                  isActive
                    ? "border-ed-brand-ink text-ed-brand-ink"
                    : "border-transparent text-ed-ink/60 hover:text-ed-ink"
                }`}
              >
                {topic.text}
              </a>
            </li>,
            ...topic.lessons.map((lesson) => (
              <li key={lesson.id} className="-ml-px">
                <a
                  href={`#${lesson.id}`}
                  onClick={go(lesson.id, topic.id)}
                  className="block border-l-2 border-transparent py-1 pl-7 text-ed-12 font-book leading-snug text-ed-ink/50 no-underline transition-colors duration-150 hover:text-ed-ink/80"
                >
                  {lesson.text}
                </a>
              </li>
            ))
          ];
        })}
      </ul>
    </nav>
  );
}
