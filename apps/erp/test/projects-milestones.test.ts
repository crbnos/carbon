// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  milestoneGroup,
  summarizeMilestones
} from "~/modules/projects/projects.models";

const TODAY = "2026-10-09";

const milestone = (
  id: string,
  startDate: string | null,
  endDate: string | null,
  completedAt: string | null = null
) => ({ id, startDate, endDate, completedAt });

describe("milestoneGroup", () => {
  it("puts a completed milestone in Completed", () => {
    expect(
      milestoneGroup(
        milestone("m", "2026-10-01", "2026-10-20", "2026-10-05T10:00:00Z"),
        TODAY
      )
    ).toBe("Completed");
  });

  it("puts a milestone that has started in Active", () => {
    expect(
      milestoneGroup(milestone("m", "2026-10-01", "2026-10-20"), TODAY)
    ).toBe("Active");
    expect(milestoneGroup(milestone("m", TODAY, TODAY), TODAY)).toBe("Active");
  });

  it("puts a milestone that starts later, or has no dates, in Upcoming", () => {
    expect(
      milestoneGroup(milestone("m", "2026-10-10", "2026-10-20"), TODAY)
    ).toBe("Upcoming");
    expect(milestoneGroup(milestone("m", null, null), TODAY)).toBe("Upcoming");
  });

  it("keeps an overdue milestone in Active", () => {
    expect(
      milestoneGroup(milestone("m", "2026-09-01", "2026-09-30"), TODAY)
    ).toBe("Active");
    expect(milestoneGroup(milestone("m", null, "2026-09-30"), TODAY)).toBe(
      "Active"
    );
  });
});

describe("summarizeMilestones", () => {
  it("counts elements, hours and cost per milestone", () => {
    const [summary, empty] = summarizeMilestones({
      milestones: [
        milestone("m1", "2026-09-01", "2026-09-30"),
        milestone("m2", null, null)
      ],
      elements: [
        {
          id: "a",
          milestoneId: "m1",
          estimatedHours: 10,
          budget: 1000,
          state: { group: "Completed" }
        },
        {
          id: "b",
          milestoneId: "m1",
          estimatedHours: 6,
          budget: null,
          state: { group: "Started" }
        },
        {
          id: "c",
          milestoneId: "m1",
          estimatedHours: 99,
          budget: 99,
          state: { group: "Cancelled" }
        },
        {
          id: "d",
          milestoneId: null,
          estimatedHours: 5,
          budget: 5,
          state: { group: "Started" }
        }
      ],
      costSummary: [
        { projectElementId: "a", actual: 400, actualHours: 8 },
        { projectElementId: "b", actual: 50, actualHours: 1.5 },
        { projectElementId: "c", actual: 70, actualHours: 2 },
        { projectElementId: null, actual: 30, actualHours: 0 }
      ],
      today: TODAY
    });

    expect(summary).toMatchObject({
      id: "m1",
      group: "Active",
      isOverdue: true,
      elementCount: 2,
      completedCount: 1,
      estimatedHours: 16,
      actualHours: 9.5,
      budget: 1000,
      actualCost: 450
    });
    expect(empty).toMatchObject({
      id: "m2",
      group: "Upcoming",
      isOverdue: false,
      elementCount: 0,
      actualCost: 0
    });
  });
});
