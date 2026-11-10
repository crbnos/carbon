// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useViewport } from "@carbon/react";
import { useEffect, useState } from "react";

/**
 * Phones: a page's bottom action bar. Give the returned ref to the bar (it
 * also carries `data-mes-bottom-bar`). The bar publishes how far its top edge
 * sits above the screen bottom as `--mes-bottom-bar-h` on <html>, so toasts
 * and the console pill clear it. The distance already includes the safe area
 * and anything under the bar (the tab bar under My Hours' Clock In bar).
 */
export function useMesBottomBar() {
  const { isPhone } = useViewport();
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isPhone || !element) return;
    const root = document.documentElement;
    const write = () => {
      const top = element.getBoundingClientRect().top;
      root.style.setProperty(
        "--mes-bottom-bar-h",
        `${Math.max(0, window.innerHeight - top)}px`
      );
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(element);
    window.addEventListener("resize", write);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
      root.style.removeProperty("--mes-bottom-bar-h");
    };
  }, [isPhone, element]);

  return setElement;
}
