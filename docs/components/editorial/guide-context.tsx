"use client";

/**
 * GuideProvider owns the editorial reader's active-chapter/section state and all
 * scroll orchestration, so BOTH the header and the sidebar switch chapters with
 * pure client state — no Next route navigation, no remount, no flash.
 *
 * Chapter content is authored in MDX; the server passes down a serializable
 * `chapters` list (slug/title/label + the section items derived from each file's
 * table of contents) plus the rendered bodies. Section anchors are the heading ids
 * Fumadocs' rehype-slug already injected, so the rail, scrollspy, and deep links all
 * key off the same id.
 *
 * Chapter changes animate via the View Transitions API; reduced-motion users get an
 * instant swap. The URL is kept in sync silently via history.replaceState.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

export type GuideItem = { title: string; id: string };

export type GuideChapter = {
  slug: string;
  index: number;
  title: string;
  description: string;
  label: string;
  flow: string;
  flowName: string;
  flowIndex: number;
  readingTime: number;
  /** Repo-relative path to the chapter's source MDX, for the "Edit on GitHub" link. */
  editPath: string;
  items: GuideItem[];
};

export type GuideFlow = { slug: string; name: string; firstIndex: number };

/** Distinct flows in reading order, each with the global index of its first chapter.
 *  `chapters` is already sorted by (flowIndex, index), so each flow is contiguous. */
export function flowsOf(chapters: GuideChapter[]): GuideFlow[] {
  const out: GuideFlow[] = [];
  chapters.forEach((c, i) => {
    if (!out.some((f) => f.slug === c.flow)) out.push({ slug: c.flow, name: c.flowName, firstIndex: i });
  });
  return out;
}

/** The chapters belonging to one flow, each paired with its global index. */
export function chaptersInFlow(
  chapters: GuideChapter[],
  flow: string,
): { chapter: GuideChapter; index: number }[] {
  return chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter((x) => x.chapter.flow === flow);
}

type Pos = { chapter: number; item: number };

type GuideCtx = {
  active: Pos;
  goTo: (pos: Pos) => void;
  chapters: GuideChapter[];
};

const Ctx = createContext<GuideCtx | null>(null);

type ViewTransitionLike = { finished?: Promise<unknown>; ready?: Promise<unknown> };
type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => ViewTransitionLike;
};

/** Fixed chrome above the scrolling content: 64px header + 52px subnav (desktop) or
 *  mobile context bar. The reader scrolls the window, so anchors and the scrollspy
 *  offset by this to land headings just below the chrome. */
const CHROME = 116;

export function GuideProvider({
  chapters,
  initialSlug,
  children,
}: {
  chapters: GuideChapter[];
  initialSlug: string;
  children: ReactNode;
}) {
  const initialChapter = Math.max(
    0,
    chapters.findIndex((c) => c.slug === initialSlug),
  );
  const [active, setActive] = useState<Pos>({ chapter: initialChapter, item: 0 });

  const activeRef = useRef(active);
  activeRef.current = active;

  const isUserScrolling = useRef(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smooth scrolls omit `behavior`, deferring to the `scroll-behavior: smooth` on <html>
  // — so reduced-motion users get an instant jump for free (their media query forces it
  // back to `auto`). Chapter swaps pass smooth=false to land instantly under the view
  // transition, where a glide would just fight the crossfade.
  const scrollToAnchor = useCallback((id: string, smooth: boolean) => {
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - CHROME - 16);
    window.scrollTo(smooth ? { top } : { top, behavior: "auto" });
  }, []);

  const scrollToTop = useCallback((smooth: boolean) => {
    window.scrollTo(smooth ? { top: 0 } : { top: 0, behavior: "auto" });
  }, []);

  const goTo = useCallback(
    (pos: Pos) => {
      const chapter = chapters[pos.chapter];
      if (!chapter) return;

      const prev = activeRef.current;
      const isNewChapter = pos.chapter !== prev.chapter;
      // Only an explicit deeper section (item > 0) is a scroll target. Item 0 is the
      // chapter's opening — landing there means the top of the page (its title + intro),
      // not the first ## heading. Flow switches, prev/next, and Home all pass item 0, so
      // they start at the top, and only a real section puts a #hash in the URL.
      const anchor = pos.item > 0 ? (chapter.items[pos.item]?.id ?? "") : "";
      // Mirror the active section in the URL so a sidebar click is shareable: land on
      // /guides/<slug>#<section-id> (or bare /guides/<slug> for the chapter top).
      const url = anchor ? `/guides/${chapter.slug}#${anchor}` : `/guides/${chapter.slug}`;

      // Suppress the scrollspy while we drive the scroll programmatically.
      isUserScrolling.current = true;
      if (guardTimer.current) clearTimeout(guardTimer.current);
      guardTimer.current = setTimeout(() => {
        isUserScrolling.current = false;
      }, 700);

      if (!isNewChapter) {
        // Same chapter — glide to the targeted section, or back up to the top.
        setActive(pos);
        window.history.replaceState(null, "", url);
        requestAnimationFrame(() => (anchor ? scrollToAnchor(anchor, true) : scrollToTop(true)));
        return;
      }

      // New chapter — swap content inside a view transition and land instantly: at the
      // targeted section, or the top of the page when no section is targeted.
      const apply = () => {
        flushSync(() => setActive(pos));
        if (anchor) scrollToAnchor(anchor, false);
        else scrollToTop(false);
      };

      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const doc = document as DocWithVT;

      if (!reduce && typeof doc.startViewTransition === "function") {
        // Swallow the benign "transition aborted" rejection on fast chapter switches.
        const t = doc.startViewTransition(apply);
        t?.finished?.catch(() => {});
        t?.ready?.catch(() => {});
      } else {
        apply();
      }

      window.history.replaceState(null, "", url);
    },
    [chapters, scrollToAnchor, scrollToTop],
  );

  // The header wordmark fires `carbon:home` (a plain <Link href="/"> can't reset the
  // reader — replaceState has desynced Next's router from the real URL). Reset to the
  // first chapter so the logo always returns to the start of the guide.
  useEffect(() => {
    const home = () => goTo({ chapter: 0, item: 0 });
    window.addEventListener("carbon:home", home);
    return () => window.removeEventListener("carbon:home", home);
  }, [goTo]);

  // Scrollspy: update the active section as the reader scrolls the window. A section
  // becomes active once its heading passes just under the fixed chrome.
  useEffect(() => {
    const handleScroll = () => {
      if (isUserScrolling.current) return;
      const chapter = chapters[activeRef.current.chapter];
      if (!chapter) return;

      const threshold = CHROME + 48;
      let closestItem = 0;
      for (let i = 0; i < chapter.items.length; i++) {
        const heading = document.getElementById(chapter.items[i].id);
        if (heading && heading.getBoundingClientRect().top <= threshold) {
          closestItem = i;
        }
      }
      setActive((p) => (p.item === closestItem ? p : { ...p, item: closestItem }));
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [chapters, active.chapter]);

  return (
    <Ctx.Provider value={{ active, goTo, chapters }}>{children}</Ctx.Provider>
  );
}

export function useGuide() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGuide must be used within a GuideProvider");
  return ctx;
}
