import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * Smooth-scrolls to the element whose id matches the current URL hash and
 * briefly rings it, so a deep link (e.g. an onboarding "jump to section" link)
 * lands the user on the right card. Give the target a `scroll-mt-*` for offset.
 */
export function useScrollToHash() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-primary");
    const timeout = setTimeout(
      () => el.classList.remove("ring-2", "ring-primary"),
      1600
    );
    return () => clearTimeout(timeout);
  }, [hash]);
}
