import { describe, expect, it } from "vitest";
import { getSalesOrderJobStatus } from "./status";

// Cancelled jobs must never count as active work: they contribute no coverage
// and don't count as "having jobs". A Make-to-Order line whose only job is
// cancelled should read "Requires Jobs", and a partially-cancelled line's
// coverage should ignore the cancelled job.
type Jobs = Parameters<typeof getSalesOrderJobStatus>[0];
type Line = Parameters<typeof getSalesOrderJobStatus>[1];

const makeLine = (overrides: Partial<Line> = {}): Line =>
  ({
    id: "line-1",
    methodType: "Make to Order",
    saleQuantity: 10,
    quantitySent: 0,
    sentComplete: false,
    invoicedComplete: false,
    salesOrderLineType: "Part",
    ...overrides
  }) as Line;

const makeJob = (overrides: Partial<NonNullable<Jobs>[number]> = {}) =>
  ({
    id: "job-1",
    jobId: "J1",
    salesOrderLineId: "line-1",
    productionQuantity: 10,
    quantityComplete: 0,
    status: "Planned",
    dueDate: null,
    ...overrides
  }) as NonNullable<Jobs>[number];

describe("getSalesOrderJobStatus", () => {
  it("treats a cancelled-only Make-to-Order line as Requires Jobs", () => {
    const result = getSalesOrderJobStatus(
      [makeJob({ status: "Cancelled" })],
      makeLine()
    );
    expect(result.jobLabel).toBe("Requires Jobs");
  });

  it("excludes cancelled jobs from production coverage", () => {
    // A cancelled job with full production quantity + a small active job should
    // not read as sufficiently covered.
    const result = getSalesOrderJobStatus(
      [
        makeJob({
          id: "cancelled",
          status: "Cancelled",
          productionQuantity: 10
        }),
        makeJob({
          id: "active",
          status: "In Progress",
          productionQuantity: 2
        })
      ],
      makeLine()
    );
    // Active coverage (2) < saleQuantity (10), so it is not Completed.
    expect(result.jobLabel).not.toBe("Completed");
  });

  it("excludes cancelled jobs from released-work detection", () => {
    // Only a cancelled (non-Planned/Draft) job exists — no active work released,
    // so the line stays Planned rather than reading In Progress.
    const result = getSalesOrderJobStatus(
      [makeJob({ status: "Cancelled" })],
      makeLine({ saleQuantity: 10 })
    );
    expect(result.jobLabel).not.toBe("In Progress");
  });
});
