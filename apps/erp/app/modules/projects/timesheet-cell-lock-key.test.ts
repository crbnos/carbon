// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { timesheetCellLockKey } from "./projects.utils";

type Cell = Parameters<typeof timesheetCellLockKey>[0];

const base = (overrides: Partial<Cell> = {}): Cell => ({
  companyId: "co1",
  employeeId: "emp1",
  entryDate: "2026-11-24",
  projectId: "prj1",
  projectElementId: "el1",
  laborCategoryId: "lc1",
  workLocationId: null,
  rdActivityRole: null,
  ...overrides
});

describe("timesheetCellLockKey", () => {
  it("keys the cell on its company, employee, day and charge columns", () => {
    expect(timesheetCellLockKey(base())).toBe(
      'timesheet-cell:["co1","emp1","2026-11-24","prj1","el1","lc1",null,null]'
    );
  });

  it.each<[string, Partial<Cell>]>([
    ["project", { projectId: "prj2" }],
    ["element", { projectElementId: "el2" }],
    ["no element", { projectElementId: null }],
    ["labor category", { laborCategoryId: "lc2" }],
    ["work location", { workLocationId: "loc1" }],
    ["research role", { rdActivityRole: "Direct Research" }],
    ["employee", { employeeId: "emp2" }],
    ["company", { companyId: "co2" }]
  ])("gives another %s on the same day a different key", (_, overrides) => {
    expect(timesheetCellLockKey(base(overrides))).not.toBe(
      timesheetCellLockKey(base())
    );
  });

  it("gives the next day a different key", () => {
    expect(timesheetCellLockKey(base({ entryDate: "2026-11-25" }))).not.toBe(
      timesheetCellLockKey(base())
    );
  });

  it("keeps a null column apart from an id that reads null", () => {
    expect(timesheetCellLockKey(base({ workLocationId: "null" }))).not.toBe(
      timesheetCellLockKey(base())
    );
  });
});
