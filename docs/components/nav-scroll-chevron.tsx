"use client";

import { useEffect, useRef, useState } from "react";

/* Sits at the bottom of the nav sidebar (its closest scrolling <aside>) and shows a
 * fade + down-chevron whenever there's more nav below the fold. Hides once the list
 * is scrolled to the end. The top-edge fade is handled by the `.nav-scroll-fade`
 * mask in reference.css. */
export function NavScrollChevron() {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const scroller = ref.current?.closest("aside");
    if (!scroller) return;
    const update = () => {
      setMore(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 8);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={`pointer-events-none sticky bottom-[-28px] z-10 -mx-[20px] flex h-[48px] items-end justify-center pb-[12px] transition-opacity duration-200 ${
        more ? "opacity-100" : "opacity-0"
      }`}
      style={{ background: "linear-gradient(to top, #FBFBF9 42%, rgba(251,251,249,0))" }}
    >
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[#E7E7E3] bg-[#FBFBF8] text-[rgba(38,35,35,0.5)] shadow-[0_2px_6px_-2px_rgba(0,0,0,0.2)]">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
