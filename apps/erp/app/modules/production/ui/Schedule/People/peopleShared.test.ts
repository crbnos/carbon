// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { editorDayRows } from "./peopleShared";

const row = (
  id: string,
  employeeId: string,
  shiftId: string | null,
  date = "2026-10-28"
) => ({ id, employeeId, shiftId, date, workCenterId: `wc-${id}` });

describe("editorDayRows", () => {
  const employeeShiftId = { ann: "day", bob: "night" };
  const rows = [
    row("stamped-day", "ann", "day"),
    row("unstamped", "ann", null),
    row("stamped-night", "ann", "night"),
    row("other-person", "bob", "day"),
    row("other-date", "ann", "day", "2026-10-29")
  ];

  it("keeps every row of the save's shift, stamped or resolved through the person's shift", () => {
    expect(
      editorDayRows(rows, "ann", "2026-10-28", "day", employeeShiftId).map(
        (r) => r.id
      )
    ).toEqual(["stamped-day", "unstamped"]);
  });

  it("keeps rows of the save's shift that a filter on another shift hides", () => {
    // the page shows the night shift; Ann's editor saves her own (day) shift
    expect(
      editorDayRows(rows, "ann", "2026-10-28", "day", employeeShiftId)
    ).toHaveLength(2);
  });

  it("keeps every row of the day when the save has no shift", () => {
    expect(
      editorDayRows(rows, "ann", "2026-10-28", null, {}).map((r) => r.id)
    ).toEqual(["stamped-day", "unstamped", "stamped-night"]);
  });
});
