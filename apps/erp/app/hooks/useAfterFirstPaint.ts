// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { startTransition, useEffect, useState } from "react";

/**
 * False until the component's first frame is on screen, then true.
 *
 * For a surface that animates in (a drawer, a sheet) and holds something
 * expensive to build. Mounting it all at once blocks the main thread BEFORE the
 * first frame, so the click is followed by nothing and then the whole thing at
 * once. Render the cheap shell first, gate the heavy part on this, and the
 * surface starts moving immediately — a transform animation runs on the
 * compositor, so it keeps going while the rest is built.
 *
 * Two animation frames, not one: a `requestAnimationFrame` callback runs before
 * its frame is painted, so the first proves nothing; the second runs after the
 * shell's frame has been drawn. The flip is a transition, which lets React
 * yield between components instead of building the heavy part in one block.
 */
export function useAfterFirstPaint(): boolean {
  const [isPainted, setIsPainted] = useState(false);

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        startTransition(() => setIsPainted(true));
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  return isPainted;
}
