// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { TimesheetWeekEntry } from "./projects.service";
import { groupTimesheetRows, timesheetRowKey } from "./projects.service";

function entry(
  overrides: Partial<TimesheetWeekEntry> & { id: string }
): TimesheetWeekEntry {
  return {
    entryDate: "2026-10-05",
    projectId: "proj",
    projectElementId: "el",
    laborCategoryId: "cat",
    workLocationId: null,
    rdActivityRole: null,
    hours: 4,
    status: "Draft",
    workLocation: null,
    project: { id: "proj", identifier: "P-1", name: "Project" },
    element: { id: "el", readableId: "P-1.1", name: "Task", isLeave: false },
    laborCategory: { id: "cat", name: "Engineer" },
    ...overrides
  } as TimesheetWeekEntry;
}

describe("groupTimesheetRows (R&D tax)", () => {
  it("keeps entries that differ by location or role on their own rows", () => {
    const rows = groupTimesheetRows([
      entry({ id: "a" }),
      entry({
        id: "b",
        workLocationId: "loc-de",
        workLocation: { id: "loc-de", name: "Werk" }
      }),
      entry({ id: "c", rdActivityRole: "Direct Support" })
    ]);
    expect(rows).toHaveLength(3);
    const abroad = rows.find((row) => row.workLocationId === "loc-de");
    expect(abroad?.workLocation).toEqual("Werk");
    expect(abroad?.rdActivityRole).toBeNull();
    expect(rows.find((row) => row.rdActivityRole)?.rdActivityRole).toEqual(
      "Direct Support"
    );
  });

  it("gives a new row with the default values the key of its saved entry", () => {
    const [saved] = groupTimesheetRows([
      entry({
        id: "a",
        workLocationId: "loc-us",
        rdActivityRole: "Direct Research"
      })
    ]);
    expect(
      timesheetRowKey({
        projectId: "proj",
        projectElementId: "el",
        laborCategoryId: "cat",
        workLocationId: "loc-us",
        rdActivityRole: "Direct Research"
      })
    ).toEqual(saved?.key);
  });

  it("carries the element's leave flag, which DCAA mode reads for future days", () => {
    const [leave, project] = groupTimesheetRows([
      entry({
        id: "a",
        element: { id: "el", readableId: "P-1.1", name: "PTO", isLeave: true }
      }),
      entry({ id: "b", projectElementId: null, element: null })
    ]);
    expect(leave?.isLeave).toBe(true);
    expect(project?.isLeave).toBe(false);
  });
});
