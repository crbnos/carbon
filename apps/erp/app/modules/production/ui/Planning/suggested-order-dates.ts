// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The order drawer's suggested-order dates: a start (order-by) date and a due
// date one lead time apart. Pure — unit-tested by
// apps/erp/test/suggested-order-dates.test.ts.

import { parseDate } from "@internationalized/date";

export type SuggestedOrderDates = {
  startDate?: string | null;
  dueDate?: string | null;
  isASAP?: boolean;
};

/** The order starting on `startDate` and due a lead time later; ASAP only
 *  while that start is before today. */
export function withStartDate<O extends SuggestedOrderDates>(
  order: O,
  startDate: string,
  leadTime: number,
  todayIso: string
): O {
  return {
    ...order,
    startDate,
    dueDate: parseDate(startDate).add({ days: leadTime }).toString(),
    ...(order.isASAP !== undefined && { isASAP: startDate < todayIso })
  };
}

/** Reschedule from today: starts today and is due a lead time later. Late
 *  work stays ASAP so it keeps its place at the front of the queue; a date the
 *  planner types is what clears the flag. */
export function rescheduledFromToday<O extends SuggestedOrderDates>(
  order: O,
  leadTime: number,
  todayIso: string
): O {
  return {
    ...withStartDate(order, todayIso, leadTime, todayIso),
    ...(order.isASAP !== undefined && { isASAP: order.isASAP })
  };
}

/** After a cell edit, moves the other date of each changed row so start and
 *  due stay a lead time apart. A grid edit changes one date at a time. */
export function withDatesInStep<O extends SuggestedOrderDates>(
  next: O[],
  previous: O[],
  leadTime: number,
  todayIso: string
): O[] {
  return next.map((order, index) => {
    const before = previous[index];
    if (!before) return order;
    if (order.startDate && order.startDate !== before.startDate) {
      return withStartDate(order, order.startDate, leadTime, todayIso);
    }
    if (order.dueDate && order.dueDate !== before.dueDate) {
      const startDate = parseDate(order.dueDate)
        .subtract({ days: leadTime })
        .toString();
      return withStartDate(order, startDate, leadTime, todayIso);
    }
    return order;
  });
}
