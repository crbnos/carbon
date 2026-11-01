// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  assemblyInstructionStepValidator,
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
