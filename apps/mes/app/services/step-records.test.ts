// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { allStepsRecordedAt } from "./step-records";

const step = (...indexes: number[]) => ({
  jobOperationStepRecord: indexes.map((index) => ({ index }))
});

describe("allStepsRecordedAt", () => {
  it("is false while a step has no record at all", () => {
    expect(allStepsRecordedAt([step(0), step()], 0)).toBe(false);
  });

  it("is false when a step is recorded only in another record set", () => {
    expect(allStepsRecordedAt([step(0), step(1)], 0)).toBe(false);
  });

  it("is true when every step has a record in this record set", () => {
    expect(allStepsRecordedAt([step(0, 1), step(1)], 1)).toBe(true);
  });

  it("is true for an operation with no steps", () => {
    expect(allStepsRecordedAt([], 0)).toBe(true);
  });

  it("treats a missing record list as no records", () => {
    expect(allStepsRecordedAt([{ jobOperationStepRecord: null }], 0)).toBe(
      false
    );
  });
});
