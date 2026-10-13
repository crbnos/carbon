// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Unattributed Time list's search and filters, read from the URL. The
 * list and the review queue both apply them, so the queue walks the rows the
 * list shows. Pure, so it is tested without a database
 * (`apps/erp/test/machine-time-filters.ee.test.ts`).
 *
 * `startTime` and `endTime` are instants, but their filters pick company
 * days. The generic `between` filter compares an instant with a bare date: it
 * drops the last day and uses UTC days. So each day range becomes instants at
 * the company's day bounds here.
 */

import { parseDate, toZoned } from "@internationalized/date";

export type MachineTimeListFilters = {
  search: string | null;
  workCenterIds: string[];
  locationIds: string[];
  /** Instants: inclusive start, exclusive end, at the company's day bounds. */
  start: { from: string | null; until: string | null };
  end: { from: string | null; until: string | null };
  state: "Running" | "Stopped" | null;
};

/** The first instant of a `YYYY-MM-DD` company day, or null if it is not a date. */
function dayStart(date: string, timeZone: string, addDays = 0) {
  try {
    return toZoned(
      parseDate(date).add({ days: addDays }),
      timeZone
    ).toAbsoluteString();
  } catch {
    return null;
  }
}

function dayRange(value: string, timeZone: string) {
  // Same `from,to` split as `parseRangeFilter` (`~/utils/query`). That module
  // imports `@carbon/auth`, whose Lingui macros fail outside the Vite build,
  // so this pure file cannot import it.
  const [from, to] = value.split(",");
  return {
    from: from ? dayStart(from, timeZone) : null,
    // Exclusive: the start of the day after `to`.
    until: to ? dayStart(to, timeZone, 1) : null
  };
}

export function parseMachineTimeListFilters(
  searchParams: URLSearchParams,
  timeZone: string
): MachineTimeListFilters {
  const filters: MachineTimeListFilters = {
    search: searchParams.get("search") || null,
    workCenterIds: [],
    locationIds: [],
    start: { from: null, until: null },
    end: { from: null, until: null },
    state: null
  };

  for (const filter of searchParams.getAll("filter")) {
    const [column, operator, value] = filter.split(":");
    if (!column || !operator || !value) continue;

    switch (column) {
      case "workCenterId":
        filters.workCenterIds = value.split(",").filter(Boolean);
        break;
      case "locationId":
        filters.locationIds = value.split(",").filter(Boolean);
        break;
      case "startTime":
        if (operator === "between") filters.start = dayRange(value, timeZone);
        break;
      case "endTime":
        if (operator === "between") filters.end = dayRange(value, timeZone);
        break;
      case "state":
        if (value === "Running" || value === "Stopped") filters.state = value;
        break;
    }
  }

  return filters;
}
