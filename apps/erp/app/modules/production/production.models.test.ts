// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  assemblyInstructionStepValidator,
  demandProjectionRows,
  isBatchDissolvable,
  isBatchReleasable,
  isJobBulkReleasable,
  isJobDeletable,
  jobStatus
} from "./production.models";

describe("isJobDeletable", () => {
  it("accepts Draft, Planned and the 2 deprecated due statuses only", () => {
    const deletable = jobStatus.filter(isJobDeletable);
    expect(deletable).toEqual(["Draft", "Planned", "Overdue", "Due Today"]);
    expect(isJobDeletable(null)).toBe(false);
  });
});

describe("isJobBulkReleasable", () => {
  it("accepts Draft and Planned only", () => {
    expect(jobStatus.filter(isJobBulkReleasable)).toEqual(["Draft", "Planned"]);
  });
});

describe("batch status gates", () => {
  const statuses = ["Planned", "Active", "Completing", "Completed"];

  it("releases a Planned batch only", () => {
    expect(statuses.filter(isBatchReleasable)).toEqual(["Planned"]);
  });

  it("dissolves a Planned or Active batch only", () => {
    expect(statuses.filter(isBatchDissolvable)).toEqual(["Planned", "Active"]);
  });
});

// An assembly instruction List step needs at least one option, like the bill of
// process steps (shared.models.test.ts). Blank rows are dropped first, so the
// empty row "Add option" leaves behind never blocks a save and is never stored.
describe("assemblyInstructionStepValidator list options", () => {
  const listStep = (listValues?: string[]) => ({
    assemblyInstructionId: "ai1",
    title: "Pick a finish",
    type: "List" as const,
    listValues
  });

  const listValuesError = (listValues?: string[]) => {
    const result = assemblyInstructionStepValidator.safeParse(
      listStep(listValues)
    );
    if (result.success) return undefined;
    return result.error.issues.find(
      (issue) => issue.path.join(".") === "listValues"
    )?.message;
  };

  it("requires at least one option", () => {
    expect(listValuesError(undefined)).toBe("List options are required");
    expect(listValuesError([])).toBe("List options are required");
  });

  it("treats a list of blank rows as no options", () => {
    expect(listValuesError(["", "  "])).toBe("List options are required");
  });

  it("drops a trailing empty row instead of refusing the save", () => {
    const result = assemblyInstructionStepValidator.safeParse(
      listStep(["Matte", "Gloss", ""])
    );
    expect(result.success).toBe(true);
    expect(result.data?.listValues).toEqual(["Matte", "Gloss"]);
  });

  it("does not require options on other step types", () => {
    expect(
      assemblyInstructionStepValidator.safeParse({
        ...listStep(),
        type: "Task"
      }).success
    ).toBe(true);
  });
});

describe("demandProjectionRows", () => {
  const formWeeks = [
    { id: "p-1", startDate: "2026-11-22" },
    { id: "p-2", startDate: "2026-11-29" }
  ];
  const plan = (weeks: { weekStart: string; quantity: number }[]) =>
    demandProjectionRows(
      formWeeks,
      { itemId: "item-1", locationId: "loc-1", weeks },
      { companyId: "company-1", userId: "user-1" }
    );

  it("names each week's period by its start date", () => {
    expect(plan([{ weekStart: "2026-11-29", quantity: 4 }])).toEqual({
      rows: [
        {
          itemId: "item-1",
          locationId: "loc-1",
          periodId: "p-2",
          weekStart: "2026-11-29",
          forecastQuantity: 4,
          companyId: "company-1",
          createdBy: "user-1",
          updatedBy: "user-1"
        }
      ]
    });
  });

  // The week after the window, and a Monday inside it: neither is a column.
  it.each(["2026-12-06", "2026-11-23"])(
    "refuses %s, which no form week starts on",
    (weekStart) => {
      expect(plan([{ weekStart, quantity: 1 }])).toHaveProperty("refusal");
    }
  );

  it("refuses a week sent twice", () => {
    expect(
      plan([
        { weekStart: "2026-11-22", quantity: 1 },
        { weekStart: "2026-11-22", quantity: 2 }
      ])
    ).toHaveProperty("refusal");
  });
});
