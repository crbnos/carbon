import { useEffect, useState } from "react";

type UseScrollPositionResult = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

/**
 * A hook to track the scroll position of an element
 * @param {HTMLDivElement | (() => HTMLDivElement | undefined) | undefined} element - The element or an element getter to track the scroll position of
 * @returns {UseScrollPositionResult}
 */
export const useScrollPosition = (
  element?: HTMLDivElement | (() => HTMLDivElement | undefined)
): UseScrollPositionResult => {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = typeof element === "function" ? element() : element;

    if (el) {
      // Set initial scroll state
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(
        Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth
      );
    }

    const scrollListener: EventListener = (e) => {
      const { scrollLeft, scrollWidth, clientWidth } = (e.target ??
        {}) as HTMLDivElement;

      // Set updated scroll state
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
    };

    const resizeListener: EventListener = () => {
      if (el) {
        const { scrollLeft, scrollWidth, clientWidth } = el;

        // Set updated scroll state
        setCanScrollLeft(scrollLeft > 0);
        setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
      }
    };

    // Handle scrolling
    el?.addEventListener("scroll", scrollListener);

    // Handle window resizing
    window.addEventListener("resize", resizeListener);

    return () => {
      el?.removeEventListener("scroll", scrollListener);
      window.removeEventListener("resize", resizeListener);
    };
  }, [element]);

  return {
    canScrollLeft,
    canScrollRight,
  };
};
