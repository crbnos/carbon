// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ProductionEvent } from "@carbon/mes-core";
import { getLocalTimeZone, now, parseAbsolute } from "@internationalized/date";
import { useEffect, useState } from "react";

/**
 * The elapsed time of an operation's open event, ticking once a second.
 *
 * Every instant comes from `@internationalized/date` rather than `Date`:
 * `.claude/rules/date-handling.md` bans `Date` for parsing and arithmetic, and
 * `parseAbsolute` + `ZonedDateTime.compare` is the comparison of two absolute
 * instants that rule explicitly allows.
 *
 * The elapsed value is DERIVED from the event's `startTime` on every tick, not
 * accumulated by adding a second to a counter. A phone that sleeps, or a
 * JS timer that is throttled in the background — both of which happen on a
 * tablet left on a machine — would make an accumulated counter drift away from
 * the server's own duration, and the operator's hours are what that duration
 * becomes.
 */

/** Milliseconds from an ISO instant until now, floored at zero. */
export function elapsedSince(startTime: string) {
  try {
    const tz = getLocalTimeZone();
    const ms = now(tz).compare(parseAbsolute(startTime, tz));
    // A device clock behind the server's produces a negative elapsed. Showing
    // "-00:00:14" reads as a bug; zero reads as "it just started", which is
    // what actually happened.
    return ms > 0 ? ms : 0;
  } catch {
    return 0;
  }
}

/**
 * `hh:mm:ss`, zero-padded, hours uncapped — a 30-hour event reads "30:00:00".
 *
 * The `Math.floor` calls here are splitting an integer count of seconds into
 * clock components, which is the "not in class" case `no-raw-rounding`
 * baselines (calendar buckets, relative-time math) rather than rounding a
 * value. Nothing below is a quantity, a price or a duration that is stored.
 */
export function formatElapsed(milliseconds: number) {
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Ticks while an event is open. Returns the live elapsed milliseconds, or null
 * when nothing is running — so a caller renders the server's own total rather
 * than a zero that looks like lost time.
 */
export function useTimer(openEvent: ProductionEvent | undefined) {
  const startTime = openEvent?.startTime;
  const [elapsed, setElapsed] = useState(() =>
    startTime ? elapsedSince(startTime) : null
  );

  useEffect(() => {
    if (!startTime) {
      setElapsed(null);
      return;
    }
    setElapsed(elapsedSince(startTime));
    const id = setInterval(() => setElapsed(elapsedSince(startTime)), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return elapsed;
}
