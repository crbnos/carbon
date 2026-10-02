// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useState } from "react";

/**
 * One clock read per tick, shared by everything on the time card that moves.
 *
 * The open entry's elapsed time and the week's total both grow while the
 * screen is open, and both are derived from THIS number — so they cannot drift
 * a second apart from each other, which on a screen showing "2:14:07" next to
 * "32h 15m" is exactly the kind of disagreement an operator notices and
 * reports as a bug.
 *
 * Derived, never accumulated. A counter that adds a second per tick falls
 * permanently behind when the tablet sleeps on a bench or the JS timer is
 * throttled in the background, and this number becomes somebody's paid hours.
 * `useTimer` in the operations feature takes the same line, for the same
 * reason.
 *
 * `intervalMs: null` stops the tick. A clocked-out operator's hours are all
 * settled, so re-rendering the screen every second would buy nothing and keep
 * a tablet's CPU awake for the rest of the shift.
 *
 * `Date.now()` is the narrow exception `.claude/rules/date-handling.md` allows:
 * an epoch instant used only to subtract one absolute instant from another.
 * Every calendar decision on this screen — which day an entry belongs to,
 * which days are in the week — goes through `@internationalized/date` in
 * `logic.ts` instead.
 */
export function useNowMs(intervalMs: number | null = 1000) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs === null) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return nowMs;
}
