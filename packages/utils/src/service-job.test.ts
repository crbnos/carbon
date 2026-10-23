// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

import {
  canComplete,
  coverageAccountRole,
  groupServiceTimeRows,
  isServiceJobLocked,
  manualHoursForDay,
  needsAcceptedEstimate,
  type ServiceJobRuleFields,
  type ServiceTimeRowJob,
  serviceJobPrimaryAction,
  suggestCoverage
} from "./service-job";

const job = (
  overrides: Partial<ServiceJobRuleFields> = {}
): ServiceJobRuleFields => ({
  status: "In Progress",
  coverage: "Billable",
  billingMethod: "Time and Materials",
  salesReturnOrderLineId: null,
  repairable: null,
  estimateStatus: null,
  ...overrides
});

describe("coverageAccountRole", () => {
  it("sends Billable and Contract cost to the cost of service", () => {
    expect(coverageAccountRole("Billable")).toBe("costOfServiceAccount");
    expect(coverageAccountRole("Contract")).toBe("costOfServiceAccount");
  });

  it("sends Warranty cost to warranty expense", () => {
    expect(coverageAccountRole("Warranty")).toBe("warrantyExpenseAccount");
  });
});

describe("suggestCoverage", () => {
  const asOf = "2026-10-22";
  const none = { laborWarrantyEndDate: null, partsWarrantyEndDate: null };

  it("is Billable when a warranty ended before the as-of date", () => {
    expect(
      suggestCoverage({ ...none, laborWarrantyEndDate: "2026-10-21" }, asOf)
    ).toBe("Billable");
  });

  it("is Warranty when a warranty ends on the as-of date", () => {
    expect(
      suggestCoverage({ ...none, laborWarrantyEndDate: "2026-10-22" }, asOf)
    ).toBe("Warranty");
  });

  it("is Warranty when a warranty ends after the as-of date", () => {
    expect(
      suggestCoverage({ ...none, partsWarrantyEndDate: "2027-01-01" }, asOf)
    ).toBe("Warranty");
  });

  it("is Warranty when only the parts warranty still runs", () => {
    expect(
      suggestCoverage(
        { laborWarrantyEndDate: "2026-01-01", partsWarrantyEndDate: asOf },
        asOf
      )
    ).toBe("Warranty");
  });

  it("is Billable with no warranty dates", () => {
    expect(suggestCoverage(none, asOf)).toBe("Billable");
  });
});

describe("needsAcceptedEstimate", () => {
  it("is true for a Fixed Price job", () => {
    expect(needsAcceptedEstimate(job({ billingMethod: "Fixed Price" }))).toBe(
      true
    );
  });

  it("is true for a Billable job from an RMA line", () => {
    expect(
      needsAcceptedEstimate(job({ salesReturnOrderLineId: "srol_1" }))
    ).toBe(true);
  });

  it("is false when the unit is not repairable", () => {
    expect(
      needsAcceptedEstimate(
        job({
          billingMethod: "Fixed Price",
          salesReturnOrderLineId: "srol_1",
          repairable: false
        })
      )
    ).toBe(false);
  });

  it("is false for a Time and Materials job from the office", () => {
    expect(needsAcceptedEstimate(job())).toBe(false);
  });

  it("is false for Warranty and Contract jobs", () => {
    for (const coverage of ["Warranty", "Contract"] as const) {
      expect(
        needsAcceptedEstimate(
          job({
            coverage,
            billingMethod: "Fixed Price",
            salesReturnOrderLineId: "srol_1"
          })
        )
      ).toBe(false);
    }
  });
});

describe("canComplete", () => {
  it("refuses a job that needs an estimate and has none accepted", () => {
    expect(canComplete(job({ billingMethod: "Fixed Price" }))).toBe(false);
    expect(
      canComplete(job({ billingMethod: "Fixed Price", estimateStatus: "Sent" }))
    ).toBe(false);
  });

  it("allows a job with an accepted estimate", () => {
    expect(
      canComplete(
        job({ billingMethod: "Fixed Price", estimateStatus: "Accepted" })
      )
    ).toBe(true);
  });

  it("allows a job that needs no estimate", () => {
    expect(canComplete(job())).toBe(true);
  });
});

describe("serviceJobPrimaryAction", () => {
  it("is Start for an Open job", () => {
    expect(serviceJobPrimaryAction(job({ status: "Open" }))).toBe("Start");
    expect(
      serviceJobPrimaryAction(job({ status: "Open", coverage: "Warranty" }))
    ).toBe("Start");
  });

  it("is Send Estimate for an In Progress job that needs one", () => {
    expect(
      serviceJobPrimaryAction(job({ salesReturnOrderLineId: "srol_1" }))
    ).toBe("Send Estimate");
  });

  it("is Complete for any other In Progress job", () => {
    expect(serviceJobPrimaryAction(job())).toBe("Complete");
    expect(
      serviceJobPrimaryAction(
        job({ billingMethod: "Fixed Price", estimateStatus: "Accepted" })
      )
    ).toBe("Complete");
    expect(
      serviceJobPrimaryAction(
        job({ salesReturnOrderLineId: "srol_1", repairable: false })
      )
    ).toBe("Complete");
    expect(serviceJobPrimaryAction(job({ coverage: "Warranty" }))).toBe(
      "Complete"
    );
  });

  it("is Record Response for a Billable job Awaiting Approval", () => {
    expect(
      serviceJobPrimaryAction(
        job({ status: "Awaiting Approval", estimateStatus: "Sent" })
      )
    ).toBe("Record Response");
  });

  it("is Create Invoice for a Completed Billable job", () => {
    expect(serviceJobPrimaryAction(job({ status: "Completed" }))).toBe(
      "Create Invoice"
    );
  });

  it("is nothing for a Completed Warranty or Contract job", () => {
    expect(
      serviceJobPrimaryAction(
        job({ status: "Completed", coverage: "Warranty" })
      )
    ).toBeNull();
    expect(
      serviceJobPrimaryAction(
        job({ status: "Completed", coverage: "Contract" })
      )
    ).toBeNull();
  });

  it("is nothing for On Hold, Invoiced and Cancelled jobs", () => {
    for (const status of ["On Hold", "Invoiced", "Cancelled"] as const) {
      expect(serviceJobPrimaryAction(job({ status }))).toBeNull();
    }
  });
});

describe("isServiceJobLocked", () => {
  it("locks Completed, Invoiced and Cancelled jobs", () => {
    for (const status of ["Completed", "Invoiced", "Cancelled"]) {
      expect(isServiceJobLocked(status)).toBe(true);
    }
  });

  it("leaves every other status open", () => {
    for (const status of [
      "Open",
      "Awaiting Approval",
      "In Progress",
      "On Hold",
      null
    ]) {
      expect(isServiceJobLocked(status)).toBe(false);
    }
  });
});

describe("manualHoursForDay", () => {
  it("sets the manual entry to the total on a day with only a manual entry", () => {
    expect(manualHoursForDay([{ hours: 2, startTime: null }], 3)).toBe(3);
  });

  it("gives the manual entry what the clock did not cover", () => {
    expect(
      manualHoursForDay(
        [
          { hours: 1.5, startTime: "2026-10-20T08:00:00Z" },
          { hours: 0.5, startTime: null }
        ],
        3
      )
    ).toBe(1.5);
  });

  it("refuses a total below the clock entries", () => {
    expect(
      manualHoursForDay([{ hours: 1.5, startTime: "2026-10-20T08:00:00Z" }], 1)
    ).toBeNull();
  });

  it("removes the manual entry when the total equals the clock entries", () => {
    expect(
      manualHoursForDay(
        [{ hours: 1.5, startTime: "2026-10-20T08:00:00Z" }],
        1.5
      )
    ).toBe(0);
  });
});

describe("groupServiceTimeRows", () => {
  const jobA: ServiceTimeRowJob = {
    id: "sj_a",
    serviceJobId: "SJ000002",
    status: "In Progress",
    customerName: "Acme"
  };
  const jobB: ServiceTimeRowJob = {
    id: "sj_b",
    serviceJobId: "SJ000001",
    status: "Completed",
    customerName: null
  };

  it("sums each job's entries per day and adds assigned jobs with no time", () => {
    const rows = groupServiceTimeRows(
      [
        {
          entryDate: "2026-10-20",
          hours: 1.5,
          startTime: "2026-10-20T08:00:00Z",
          createdAt: "2026-10-20T09:30:00Z",
          job: jobA
        },
        {
          entryDate: "2026-10-20",
          hours: 1,
          startTime: null,
          createdAt: "2026-10-20T08:00:00Z",
          job: jobA
        }
      ],
      [{ job: jobA }, { job: jobB }]
    );
    expect(rows.map((row) => row.serviceJobId)).toEqual([
      "SJ000001",
      "SJ000002"
    ]);
    expect(rows[0]).toMatchObject({ isLocked: true, cells: {}, total: 0 });
    expect(rows[1]).toMatchObject({
      isLocked: false,
      total: 2.5,
      cells: {
        "2026-10-20": {
          hours: 2.5,
          clockHours: 1.5,
          createdAt: "2026-10-20T08:00:00Z"
        }
      }
    });
  });
});
