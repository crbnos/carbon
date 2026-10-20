// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  allStepsRecordedAt,
  planBatchStepRecordRows,
  planStepRecordWrite
} from "./step-records";

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

describe("planBatchStepRecordRows", () => {
  const now = "2026-10-20T10:00:00.000Z";

  it("records a new step with the caller as recorder", () => {
    const { rows } = planBatchStepRecordRows({
      records: [{ jobOperationStepId: "s1", numericValue: 4 }],
      existing: [],
      companyId: "c1",
      userId: "u1",
      now
    });
    expect(rows).toEqual([
      {
        jobOperationStepId: "s1",
        numericValue: 4,
        index: 0,
        companyId: "c1",
        createdBy: "u1",
        updatedBy: null,
        updatedAt: null
      }
    ]);
  });

  it("keeps the recorder of a step recorded again and stamps the change", () => {
    const { rows, refusedStepIds } = planBatchStepRecordRows({
      records: [
        { jobOperationStepId: "s1", numericValue: 5 },
        { jobOperationStepId: "s2", numericValue: 6 }
      ],
      existing: [{ jobOperationStepId: "s1", createdBy: "u1" }],
      companyId: "c1",
      userId: "u1",
      now
    });
    expect(refusedStepIds).toEqual([]);
    expect(rows[0]).toMatchObject({
      createdBy: "u1",
      updatedBy: "u1",
      updatedAt: now
    });
    expect(rows[0]).not.toHaveProperty("createdAt");
    expect(rows[1]).toMatchObject({
      createdBy: "u1",
      updatedBy: null,
      updatedAt: null
    });
  });

  it("refuses steps another person recorded", () => {
    const { refusedStepIds, rows } = planBatchStepRecordRows({
      records: [
        { jobOperationStepId: "s1", numericValue: 5 },
        { jobOperationStepId: "s2", numericValue: 6 }
      ],
      existing: [{ jobOperationStepId: "s2", createdBy: "u0" }],
      companyId: "c1",
      userId: "u1",
      now
    });
    expect(refusedStepIds).toEqual(["s2"]);
    // Never written, but even so it would not take the recorder over.
    expect(rows[1]?.createdBy).toBe("u0");
  });
});

describe("planStepRecordWrite", () => {
  it("inserts a step with no record yet", () => {
    expect(planStepRecordWrite(null, "u1")).toBe("insert");
  });

  it("updates the caller's own record", () => {
    expect(planStepRecordWrite({ createdBy: "u1" }, "u1")).toBe("update");
  });

  it("refuses a record someone else made", () => {
    expect(planStepRecordWrite({ createdBy: "u0" }, "u1")).toBe("refuse");
  });
});
