// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getSalesOrderJobStatus, getSalesReturnOrderStatus } from "./status";

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

type ReturnLine = Parameters<typeof getSalesReturnOrderStatus>[0][number];

const returnLine = (overrides: Partial<ReturnLine>): ReturnLine => ({
  quantity: 1,
  quantityReceived: 1,
  closedComplete: false,
  returnType: "Return to Stock",
  disposition: "Pending",
  quantityShipped: 0,
  jobStatus: null,
  hasReplacement: false,
  ...overrides
});

const returnStatus = (...lines: ReturnLine[]) =>
  getSalesReturnOrderStatus(lines).status;

describe("getSalesReturnOrderStatus", () => {
  it("is To Receive while a line is not yet received", () => {
    expect(
      returnStatus(
        returnLine({ disposition: "Use As Is" }),
        returnLine({ quantityReceived: 0 })
      )
    ).toBe("To Receive");
  });

  it("is In Progress while a received stock line is Pending", () => {
    expect(returnStatus(returnLine({}))).toBe("In Progress");
  });

  it("is Completed once every stock line is disposed", () => {
    expect(returnStatus(returnLine({ disposition: "Use As Is" }))).toBe(
      "Completed"
    );
  });

  it("is In Progress while a received service line's job is open", () => {
    expect(
      returnStatus(
        returnLine({
          returnType: "Return for Service",
          jobStatus: "In Progress",
          quantityShipped: 1
        })
      )
    ).toBe("In Progress");
  });

  it("is In Progress while a completed service line's unit is still here", () => {
    expect(
      returnStatus(
        returnLine({ returnType: "Return for Service", jobStatus: "Completed" })
      )
    ).toBe("In Progress");
  });

  it("is Completed once a service line's unit shipped back", () => {
    expect(
      returnStatus(
        returnLine({
          returnType: "Return for Service",
          jobStatus: "Invoiced",
          quantityShipped: 1
        })
      )
    ).toBe("Completed");
  });

  it("is Completed once a warranty line is replaced and its unit scrapped", () => {
    expect(
      returnStatus(
        returnLine({
          returnType: "Return for Warranty",
          jobStatus: "Completed",
          hasReplacement: true,
          disposition: "Scrap"
        })
      )
    ).toBe("Completed");
  });

  it("keeps a replaced warranty line open until the unit is disposed", () => {
    expect(
      returnStatus(
        returnLine({
          returnType: "Return for Warranty",
          jobStatus: "Completed",
          hasReplacement: true
        })
      )
    ).toBe("In Progress");
  });

  it("resolves a short-closed line that received nothing", () => {
    expect(
      returnStatus(
        returnLine({ disposition: "Use As Is" }),
        returnLine({ quantityReceived: 0, closedComplete: true })
      )
    ).toBe("Completed");
  });
});
