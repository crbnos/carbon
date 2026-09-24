import { describe, expect, it } from "vitest";
import {
  employeeVendorName,
  mergeReimbursementLineDimensions,
  resolveReimbursementSyncGate,
  validateReimbursementAccountMapping
} from "./reimbursement-source";

describe("mergeReimbursementLineDimensions", () => {
  it("carries both legacy columns when their dimensions resolve", () => {
    expect(
      mergeReimbursementLineDimensions({
        costCenterDimensionId: "dim_cc",
        projectDimensionId: "dim_proj",
        costCenterId: "cc_eng",
        projectId: "proj_apollo",
        generic: []
      })
    ).toEqual([
      { dimensionId: "dim_cc", valueId: "cc_eng" },
      { dimensionId: "dim_proj", valueId: "proj_apollo" }
    ]);
  });

  it("lets the GENERIC row win on a collision — a human edit beats the sync's default", () => {
    // This is the precedence `post-reimbursement` applies when it writes
    // journalLineDimension, and a pushed document whose dimensions disagreed
    // with its own journal would be a reconciliation defect.
    expect(
      mergeReimbursementLineDimensions({
        costCenterDimensionId: "dim_cc",
        projectDimensionId: null,
        costCenterId: "cc_ramp_default",
        projectId: null,
        generic: [{ dimensionId: "dim_cc", valueId: "cc_reviewer_chose" }]
      })
    ).toEqual([{ dimensionId: "dim_cc", valueId: "cc_reviewer_chose" }]);
  });

  it("emits ONE value per dimension — never two refs for the same dimension", () => {
    const merged = mergeReimbursementLineDimensions({
      costCenterDimensionId: "dim_cc",
      projectDimensionId: "dim_proj",
      costCenterId: "cc_eng",
      projectId: "proj_apollo",
      generic: [
        { dimensionId: "dim_cc", valueId: "cc_other" },
        { dimensionId: "dim_dept", valueId: "dept_ops" }
      ]
    });
    expect(new Set(merged.map((d) => d.dimensionId)).size).toBe(merged.length);
    expect(merged).toEqual([
      { dimensionId: "dim_cc", valueId: "cc_other" },
      { dimensionId: "dim_proj", valueId: "proj_apollo" },
      { dimensionId: "dim_dept", valueId: "dept_ops" }
    ]);
  });

  it("drops a legacy column whose company group has no active dimension for it", () => {
    expect(
      mergeReimbursementLineDimensions({
        costCenterDimensionId: null,
        projectDimensionId: null,
        costCenterId: "cc_eng",
        projectId: "proj_apollo",
        generic: []
      })
    ).toEqual([]);
  });
});

describe("employeeVendorName", () => {
  it.each([
    [
      { id: "emp_1", firstName: "Dana", lastName: "Okafor", email: "d@x.com" },
      "Dana Okafor (d@x.com)"
    ],
    [
      { id: "emp_1", firstName: null, lastName: null, email: "d@x.com" },
      "d@x.com"
    ],
    [
      { id: "emp_1", firstName: "Dana", lastName: "Okafor", email: null },
      "Dana Okafor"
    ],
    [{ id: "emp_1", firstName: null, lastName: null, email: null }, "emp_1"]
  ])("degrades gracefully: %o -> %s", (employee, expected) => {
    expect(employeeVendorName(employee)).toBe(expected);
  });
});

describe("resolveReimbursementSyncGate", () => {
  it("passes a Posted reimbursement", () => {
    expect(
      resolveReimbursementSyncGate({
        reimbursementId: "REIMB-1",
        status: "Posted"
      })
    ).toBe(true);
  });

  it.each([
    "Draft",
    "Voided"
  ] as const)("skips a %s reimbursement WITH a reason, so its journal keeps pushing", (status) => {
    const gate = resolveReimbursementSyncGate({
      reimbursementId: "REIMB-1",
      status
    });
    expect(gate).not.toBe(true);
    expect(gate).toMatch(/must be posted/i);
  });
});

describe("validateReimbursementAccountMapping", () => {
  const reimbursement = { id: "reimb_1", reimbursementId: "REIMB-1" };
  const lines = [
    { id: "l1", accountId: "acct_travel" },
    { id: "l2", accountId: "acct_meals" }
  ];

  it("accepts a fully mapped reimbursement", () => {
    expect(() =>
      validateReimbursementAccountMapping({
        reimbursement,
        lines,
        payableAccountId: "acct_payable",
        accountsById: new Map([
          ["acct_travel", "6100"],
          ["acct_meals", "6200"],
          ["acct_payable", "2180"]
        ]),
        providerName: "Rillet"
      })
    ).not.toThrow();
  });

  it("names every unmapped account, lines and payable together", () => {
    try {
      validateReimbursementAccountMapping({
        reimbursement,
        lines,
        payableAccountId: "acct_payable",
        accountsById: new Map([["acct_travel", "6100"]]),
        providerName: "Rillet"
      });
      throw new Error("expected a JournalEntrySyncError");
    } catch (err) {
      const failure = (err as { failure: Record<string, unknown> }).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(
        (failure.metadata as { unmappedAccountIds: string[] })
          .unmappedAccountIds
      ).toEqual(["acct_meals", "acct_payable"]);
    }
  });

  it("refuses a reimbursement with no coding lines", () => {
    expect(() =>
      validateReimbursementAccountMapping({
        reimbursement,
        lines: [],
        payableAccountId: "acct_payable",
        accountsById: new Map(),
        providerName: "Rillet"
      })
    ).toThrow(/no coding lines/);
  });

  it("ignores the payable entirely when the provider cannot name one (Xero)", () => {
    expect(() =>
      validateReimbursementAccountMapping({
        reimbursement,
        lines,
        payableAccountId: null,
        accountsById: new Map([
          ["acct_travel", "420"],
          ["acct_meals", "430"]
        ]),
        providerName: "Xero",
        requirePayableAccount: false
      })
    ).not.toThrow();
  });
});
