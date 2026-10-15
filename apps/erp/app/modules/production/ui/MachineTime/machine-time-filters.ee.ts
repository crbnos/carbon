// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Unattributed Time list's search and filters, read from the URL. The
 * list and the review queue both apply them, so the queue walks the rows the
 * list shows. Pure, so it is tested without a database
 * (`apps/erp/test/machine-time-filters.ee.test.ts`).
 *
 * `startTime` and `endTime` are instants, but their filters pick days. The
 * list shows each row in its location's timezone, so the date ranges filter
 * the view's `startDate` / `endDate`: the row's dates in that same timezone.
 */

import { parseDate } from "@internationalized/date";

export type MachineTimeListFilters = {
  search: string | null;
  workCenterIds: string[];
  locationIds: string[];
  /** `YYYY-MM-DD` days in the row's location timezone, both inclusive. */
  start: { from: string | null; to: string | null };
  end: { from: string | null; to: string | null };
  state: "Running" | "Stopped" | null;
};

/** The date itself, or null if it is not a `YYYY-MM-DD` date. */
function validDate(date: string | undefined) {
  if (!date) return null;
  try {
    return parseDate(date).toString();
  } catch {
    return null;
  }
}

function dayRange(value: string) {
  // Same `from,to` split as `parseRangeFilter` (`~/utils/query`). That module
  // imports `@carbon/auth`, whose Lingui macros fail outside the Vite build,
  // so this pure file cannot import it.
  const [from, to] = value.split(",");
  return { from: validDate(from), to: validDate(to) };
}

export function parseMachineTimeListFilters(
  searchParams: URLSearchParams
): MachineTimeListFilters {
  const filters: MachineTimeListFilters = {
    search: searchParams.get("search") || null,
    workCenterIds: [],
    locationIds: [],
    start: { from: null, to: null },
    end: { from: null, to: null },
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
        if (operator === "between") filters.start = dayRange(value);
        break;
      case "endTime":
        if (operator === "between") filters.end = dayRange(value);
        break;
      case "state":
        if (value === "Running" || value === "Stopped") filters.state = value;
        break;
    }
  }

  return filters;
}

/**
 * PostgREST `or` filters for the rows above and below a row in the queue's
 * order (newest start first, then `id`, both descending). A tie on
 * `startTime` falls to `id`, so every row has exactly one place.
 */
export function machineTimeQueueKeyset(row: { id: string; startTime: string }) {
  const at = `"${row.startTime}"`;
  return {
    above: `startTime.gt.${at},and(startTime.eq.${at},id.gt.${row.id})`,
    below: `startTime.lt.${at},and(startTime.eq.${at},id.lt.${row.id})`
  };
}
