// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect } from "react";

/**
 * Runs `callback` once on mount. If the callback returns a function, it is
 * registered as the unmount cleanup — like a normal effect's teardown.
 * Any other return value (including a Promise from an `async` callback) is
 * ignored, so existing void/async callers are unaffected.
 */
export default function useMount(
  callback: () => void | (() => void) | Promise<unknown>
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    const cleanup = callback();

    if (typeof cleanup === "function") {
      return cleanup;
    }
  }, []);
}
