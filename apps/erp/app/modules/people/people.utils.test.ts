// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { employeeJobValidator } from "./people.models";
import { employeeJobHiddenFields } from "./people.utils";

// The browser validates the post first: a hidden value it refuses blocks Save silently.
const job = (
  overrides: Partial<Parameters<typeof employeeJobHiddenFields>[0]> = {}
) => ({
  laborCategoryId: "",
  timesheetRequired: true,
  flsaStatus: undefined,
  isOfficer: false,
  ...overrides
});
const post = (hidden: ReturnType<typeof employeeJobHiddenFields>) =>
  employeeJobValidator.safeParse({ locationId: "loc_1", ...hidden });

describe("employeeJobHiddenFields", () => {
  it("leaves out Officer when it is off, so a save outside DCAA passes", () => {
    const hidden = employeeJobHiddenFields(job(), {
      projectTime: true,
      dcaa: false
    });
    expect(hidden).toEqual({ flsaStatus: "" });
    expect(post(hidden).success).toBe(true);
  });

  it("leaves out Timesheet Required when it is off, so a save without a labor category passes", () => {
    const hidden = employeeJobHiddenFields(job({ timesheetRequired: false }), {
      projectTime: false,
      dcaa: true
    });
    expect(hidden).toEqual({ laborCategoryId: "" });
    expect(post(hidden).success).toBe(true);
  });

  it("posts each hidden flag that is on as on, so a save keeps it", () => {
    const hidden = employeeJobHiddenFields(
      job({ laborCategoryId: "lc_1", flsaStatus: "Exempt", isOfficer: true }),
      { projectTime: false, dcaa: false }
    );
    expect(hidden).toEqual({
      laborCategoryId: "lc_1",
      timesheetRequired: "on",
      flsaStatus: "Exempt",
      isOfficer: "on"
    });
    expect(post(hidden).data).toEqual({
      locationId: "loc_1",
      laborCategoryId: "lc_1",
      timesheetRequired: true,
      flsaStatus: "Exempt",
      isOfficer: true
    });
  });

  it("posts nothing for the fields the form shows", () => {
    expect(
      employeeJobHiddenFields(job({ isOfficer: true }), {
        projectTime: true,
        dcaa: true
      })
    ).toEqual({});
  });
});
