"use client";

import { useEffect, useState } from "react";

/* Back-to-top button for the docs (window-scrolled content). Appears once you've
 * scrolled down and smooth-scrolls to the top. The scroll *fade* affordance lives on
 * the navigation sidebar (see .scrollbar-hidden-until-scroll), not the content —
 * a paper gradient looks wrong over the dark footer. */

export function ScrollHints() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 380);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed bottom-[22px] right-[22px] z-[60] flex h-[40px] w-[40px] items-center justify-center rounded-full border border-[#E7E7E3] bg-[rgba(251,251,248,0.92)] text-[rgba(38,35,35,0.55)] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.25)] backdrop-blur transition-all duration-200 hover:-translate-y-px hover:border-[#D2D2CC] hover:text-[#262323] ${
        scrolled ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M4 10l4-4 4 4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
