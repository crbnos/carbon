// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { timesheetCellValidator } from "./models";

// The MES My Time action reads a cell through this validator and passes the
// result to save-timesheet-entry. In DCAA mode the server refuses a late or
// changed entry without its reason, so the validator must keep both reasons
// (the reason modal posts them with the cell's fields).
// The fields arrive as form strings.
function cell(extra: Record<string, string>) {
  return timesheetCellValidator.safeParse({
    intent: "cell",
    entryDate: "2026-10-06",
    projectId: "prj_1",
    projectElementId: "",
    laborCategoryId: "lc_1",
    workLocationId: "",
    rdActivityRole: "",
    hours: "2.5",
    ...extra
  });
}

describe("timesheetCellValidator (MES)", () => {
  it("keeps the change and late reasons, trimmed", () => {
    const result = cell({ reason: "  Typo  ", lateReason: "Was on travel" });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      hours: 2.5,
      reason: "Typo",
      lateReason: "Was on travel"
    });
  });

  it("leaves both out when none is given (Standard mode)", () => {
    const result = cell({ reason: "", lateReason: "" });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBeUndefined();
    expect(result.data?.lateReason).toBeUndefined();
  });
});
