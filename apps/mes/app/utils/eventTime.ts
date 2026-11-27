// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseAbsolute, type ZonedDateTime } from "@internationalized/date";

export type EventTotals = { setup: number; labor: number; machine: number };

export type TimedEvent = {
  id: string;
  type?: string | null;
  startTime: string;
  endTime?: string | null;
  duration?: number | null;
};

// Milliseconds per work type across every operator: ended events by stored duration, open ones live to `now`.
export function getEventTotals(
  events: TimedEvent[],
  now: ZonedDateTime
): EventTotals {
  const totals: EventTotals = { setup: 0, labor: 0, machine: 0 };
  for (const event of events) {
    const key = event.type?.toLowerCase();
    if (key !== "setup" && key !== "labor" && key !== "machine") continue;
    if (event.endTime) {
      totals[key] += (event.duration ?? 0) * 1000;
    } else {
      totals[key] += Math.max(
        0,
        now.compare(parseAbsolute(event.startTime, now.timeZone))
      );
    }
  }
  return totals;
}

export function formatClock(ms: number) {
  const total = Math.max(0, ms);
  const s = (total - (total % 1000)) / 1000;
  return [(s - (s % 3600)) / 3600, ((s % 3600) - (s % 60)) / 60, s % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
