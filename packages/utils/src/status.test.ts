import { describe, expect, it } from "vitest";
import { getSalesOrderJobStatus, hasIncompleteJobs } from "./status";

type Line = Parameters<typeof getSalesOrderJobStatus>[1];
type Job = NonNullable<Parameters<typeof getSalesOrderJobStatus>[0]>[number];

const line = (overrides: Partial<Line> = {}): Line =>
  ({
    id: "sol1",
    methodType: "Make to Order",
    saleQuantity: 10,
    salesOrderLineType: "Part",
    invoicedComplete: false,
    sentComplete: false,
    quantitySent: 0,
    ...overrides
  }) as Line;

const job = (overrides: Partial<Job> = {}): Job =>
  ({
    id: "job1",
    jobId: "J1",
    salesOrderLineId: "sol1",
    productionQuantity: 10,
    quantityComplete: 0,
    status: "In Progress",
    dueDate: null,
    ...overrides
  }) as Job;

describe("getSalesOrderJobStatus", () => {
  it("does not report a cancelled job as completed even when quantityComplete covers the line", () => {
    // Regression: a cancelled job retaining quantityComplete used to read as
    // "Completed" (green). Cancelled jobs must not contribute to coverage.
    const { jobLabel, jobVariant } = getSalesOrderJobStatus(
      [
        job({
          status: "Cancelled",
          quantityComplete: 10,
          productionQuantity: 10
        })
      ],
      line()
    );
    expect(jobLabel).not.toBe("Completed");
    expect(jobVariant).not.toBe("green");
  });

  it("reports a reopened job with a stale quantityComplete as In Progress, not Completed", () => {
    // quantityComplete persists after a job is reopened; completion is gated on
    // the job actually being in a completed status.
    const { jobLabel } = getSalesOrderJobStatus(
      [
        job({
          status: "In Progress",
          quantityComplete: 10,
          productionQuantity: 10
        })
      ],
      line()
    );
    expect(jobLabel).toBe("In Progress");
  });

  it("reports Completed when a completed job covers the line quantity", () => {
    const { jobLabel, jobVariant } = getSalesOrderJobStatus(
      [
        job({
          status: "Completed",
          quantityComplete: 10,
          productionQuantity: 10
        })
      ],
      line()
    );
    expect(jobLabel).toBe("Completed");
    expect(jobVariant).toBe("green");
  });
});

type IncompleteInput = Parameters<typeof hasIncompleteJobs>[0];
type IncompleteJob = NonNullable<IncompleteInput["jobs"]>[number];

const incompleteJob = (
  overrides: Partial<IncompleteJob> = {}
): IncompleteJob => ({
  salesOrderLineId: "sol1",
  productionQuantity: 10,
  quantityComplete: 0,
  status: "In Progress",
  ...overrides
});

const makeLine = {
  id: "sol1",
  methodType: "Make to Order" as const,
  saleQuantity: 10
};

describe("hasIncompleteJobs", () => {
  it("treats a line whose only job is cancelled as incomplete", () => {
    expect(
      hasIncompleteJobs({
        lines: [makeLine],
        jobs: [incompleteJob({ status: "Cancelled", quantityComplete: 10 })]
      })
    ).toBe(true);
  });

  it("treats a reopened job with a stale quantityComplete as incomplete", () => {
    // CodeRabbit feedback: completion in hasIncompleteJobs must be gated on
    // Completed/Closed, matching getSalesOrderJobStatus.
    expect(
      hasIncompleteJobs({
        lines: [makeLine],
        jobs: [incompleteJob({ status: "In Progress", quantityComplete: 10 })]
      })
    ).toBe(true);
  });

  it("treats a completed job covering the line quantity as complete", () => {
    expect(
      hasIncompleteJobs({
        lines: [makeLine],
        jobs: [incompleteJob({ status: "Completed", quantityComplete: 10 })]
      })
    ).toBe(false);
  });

  it("ignores a cancelled job when another job completes the line", () => {
    expect(
      hasIncompleteJobs({
        lines: [makeLine],
        jobs: [
          incompleteJob({ status: "Cancelled", quantityComplete: 0 }),
          incompleteJob({ status: "Completed", quantityComplete: 10 })
        ]
      })
    ).toBe(false);
  });
});
