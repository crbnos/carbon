// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";

export type BarRect = { x: number; y: number; width: number; height: number };

/** The space above and below a bar inside its row. */
const BAR_INSET = 10;

/** The whole days from `windowStart` to `date`, both `YYYY-MM-DD`. */
export function dayIndex(date: string, windowStart: string): number {
  return parseDate(date).compare(parseDate(windowStart));
}

/**
 * The bar of an element from its `startDate` to its `targetDate`, both days
 * included. An element with one date gets a 1-day bar; with no date, none.
 */
export function barRect(
  element: { startDate: string | null; targetDate: string | null },
  windowStart: string,
  dayWidth: number,
  rowIndex: number,
  rowHeight: number
): BarRect | null {
  const first = element.startDate ?? element.targetDate;
  const last = element.targetDate ?? element.startDate;
  if (!first || !last) return null;
  const from = dayIndex(first, windowStart);
  // A target before the start still draws one day, at the start.
  const to = Math.max(dayIndex(last, windowStart), from);
  return {
    x: from * dayWidth,
    y: rowIndex * rowHeight + BAR_INSET,
    width: (to - from + 1) * dayWidth,
    height: rowHeight - BAR_INSET * 2
  };
}

/**
 * An SVG path from the right end of the "from" bar to the left end of the
 * "to" bar: out to the right, one elbow, then into the target.
 */
export function arrowPath(from: BarRect, to: BarRect): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const elbowX = Math.max(startX + 8, Math.min(endX - 8, startX + 16));
  return `M ${startX} ${startY} H ${elbowX} V ${endY} H ${endX}`;
}

/**
 * The days the Timeline shows: from the earliest date less 3 days to the
 * latest date plus 7. With no date at all, the 4 weeks after `fallback`.
 */
export function defaultWindow(
  elements: { startDate: string | null; targetDate: string | null }[],
  fallback: string
): { start: string; end: string } {
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const element of elements) {
    for (const date of [element.startDate, element.targetDate]) {
      if (!date) continue;
      if (!earliest || date < earliest) earliest = date;
      if (!latest || date > latest) latest = date;
    }
  }
  if (!earliest || !latest) {
    const start = parseDate(fallback).subtract({ days: 3 });
    return {
      start: start.toString(),
      end: start.add({ days: 28 }).toString()
    };
  }
  return {
    start: parseDate(earliest).subtract({ days: 3 }).toString(),
    end: parseDate(latest).add({ days: 7 }).toString()
  };
}
