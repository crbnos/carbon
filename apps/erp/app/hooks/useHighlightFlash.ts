import { useEffect, useRef, useState } from "react";

/**
 * Drives the "flash this row" affordance used when a list entry is navigated to
 * via a `highlight` param. When `highlighted` flips true it scrolls the element
 * into view and blinks `isFlashing` a few times so the eye can find the row.
 *
 * Returns a `ref` to attach to the element to flash and an `isFlashing` flag to
 * toggle a highlight class with (pair it with a `transition-colors` on the node).
 */
export function useHighlightFlash<T extends HTMLElement = HTMLElement>(
  highlighted: boolean
) {
  const ref = useRef<T>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    if (!highlighted) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });

    // Blink a few times to draw attention to the row, then settle.
    let toggles = 0;
    const maxToggles = 6; // 3 on/off cycles
    setIsFlashing(true);
    const interval = setInterval(() => {
      toggles += 1;
      setIsFlashing((prev) => !prev);
      if (toggles >= maxToggles) {
        clearInterval(interval);
        setIsFlashing(false);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [highlighted]);

  return { ref, isFlashing };
}
