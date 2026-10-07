// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect } from "react";

export default function useEscape(
  callback: ((e?: KeyboardEvent) => void) | (() => void)
) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      // A Radix layer (menu, popover, sheet) that closed on this Escape has
      // already handled it.
      if (e.key === "Escape" && !e.defaultPrevented) {
        callback(e);
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
    };
  }, [callback]);
}
