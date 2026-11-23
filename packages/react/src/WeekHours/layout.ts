// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";

/** A dragged or clicked bar moves in half hours. */
export const HOUR_STEP = 0.5;
/** No day holds more than this. */
export const MAX_DAY_HOURS = 24;

/** Hours snapped to the half hour, never below 0 or above `max`. */
export function snapHours(hours: number, max = MAX_DAY_HOURS): number {
  if (!Number.isFinite(hours)) return 0;
  const snapped = round(hours / HOUR_STEP, 0) * HOUR_STEP;
  return Math.min(Math.max(snapped, 0), max);
}

/** One bar of a day: a row's hours, stacked under the rows before it. */
export type DayBar = { key: string; start: number; hours: number };

/**
 * The bars of one day, top to bottom in the order their time was entered
 * (`enteredAt`, the entry's creation), so new time lands at the bottom,
 * where the click that made it was. Time not saved yet (no `enteredAt`)
 * goes last; ties keep the rows' order. A row with no hours that day has
 * no bar; each bar starts where the one above it ends.
 */
export function stackDay(
  rows: { key: string; hours: number; enteredAt?: string | null }[]
): { bars: DayBar[]; total: number } {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row.enteredAt ?? null;
      const y = b.row.enteredAt ?? null;
      if (x !== y) {
        if (x === null) return 1;
        if (y === null) return -1;
        return x < y ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
  const bars: DayBar[] = [];
  let start = 0;
  for (const row of ordered) {
    if (row.hours <= 0) continue;
    bars.push({ key: row.key, start, hours: row.hours });
    start += row.hours;
  }
  return { bars, total: start };
}

/**
 * The hours a click at `pointerHours` gives the selected row: the bars
 * below the click stay, and the selected row grows (or starts) to reach the
 * click. The other rows' hours of the day are `others`; the selected row
 * gets at least half an hour and never pushes the day past 24.
 */
export function fillToPointer(args: {
  pointerHours: number;
  others: number;
  current: number;
}): number {
  const { pointerHours, others, current } = args;
  const room = MAX_DAY_HOURS - others;
  const reached = snapHours(pointerHours - others, room);
  return Math.max(reached, current > 0 ? current : HOUR_STEP);
}
