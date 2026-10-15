// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getSalesOrderJobStatus } from "./status";

type Line = Parameters<typeof getSalesOrderJobStatus>[1];
type Job = NonNullable<Parameters<typeof getSalesOrderJobStatus>[0]>[number];

const line = (overrides: Partial<Line>): Line => ({
  id: "line",
  salesOrderLineType: "Part",
  methodType: "Make to Order",
  saleQuantity: 2,
  quantitySent: 0,
  sentComplete: false,
  invoicedComplete: false,
  ...overrides
});

const job = (overrides: Partial<Job>): Job => ({
  id: "job",
  jobId: "J000001",
  salesOrderLineId: "line",
  productionQuantity: 2,
  quantityComplete: 2,
  status: "Completed",
  dueDate: null,
  ...overrides
});

const label = (l: Line, jobs: Job[]) =>
  getSalesOrderJobStatus(jobs, l).jobLabel;

describe("getSalesOrderJobStatus", () => {
  it("reads Shipped once a part line's completed jobs have shipped", () => {
    expect(
      label(line({ quantitySent: 2, sentComplete: true }), [job({})])
    ).toBe("Shipped");
    expect(label(line({ quantitySent: 1 }), [job({})])).toBe("Completed");
    expect(
      label(line({ quantitySent: 1 }), [
        job({ status: "In Progress", quantityComplete: 1 })
      ])
    ).toBe("Partially Shipped");
  });

  // Completing a service job fills quantitySent / sentComplete, but nothing
  // was shipped, so the line must never claim it was.
  it("never reads Shipped for a Service line", () => {
    const service = { salesOrderLineType: "Service" as const };
    expect(
      label(line({ ...service, quantitySent: 2, sentComplete: true }), [
        job({})
      ])
    ).toBe("Completed");
    expect(
      label(line({ ...service, quantitySent: 1 }), [
        job({ status: "In Progress", quantityComplete: 1 })
      ])
    ).toBe("In Progress");
  });
});
