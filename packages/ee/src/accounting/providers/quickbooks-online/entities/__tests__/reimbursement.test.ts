import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { ReimbursementSource } from "../../../../core/reimbursement-source";
import type { Qbo } from "../../models";
import { mapReimbursementToQboBill } from "../reimbursement";

// QBO has no native reimbursement object, so the document is a Bill against
// an employee Vendor. What the mapper must get right is the pair the spec
// cares about: account-based expense lines for the coding, and APAccountRef
// carrying Carbon's SEGREGATED employee-payable control account rather than
// letting QBO imply the trade-AP account.

const reimbursement = (
  overrides: Partial<ReimbursementSource> = {}
): ReimbursementSource => ({
  id: "reimb_1",
  companyId: "company-1",
  reimbursementId: "REIMB-2026-09-000001",
  employeeId: "emp_1",
  status: "Posted",
  integration: "ramp",
  reimbursementDate: "2026-09-18",
  postingDate: "2026-09-20",
  currencyCode: "USD",
  exchangeRate: 1,
  amount: 620,
  payableAccountId: "acct_employee_payable",
  reference: "Trip to Austin",
  notes: null,
  updatedAt: "2026-09-20T10:00:00.000Z",
  employee: {
    id: "emp_1",
    firstName: "Dana",
    lastName: "Okafor",
    email: "dana@example.com"
  },
  employeeVendorExternalId: "qbo-vendor-77",
  baseCurrencyCode: "USD",
  decimalPlaces: 2,
  lines: [
    {
      id: "reimbl_1",
      accountId: "acct_travel",
      description: "Flights",
      amount: 500,
      sequence: 0,
      dimensions: [{ dimensionId: "dim_cc", valueId: "cc_eng" }]
    },
    {
      id: "reimbl_2",
      accountId: "acct_meals",
      description: "Meals",
      amount: 120,
      sequence: 1,
      dimensions: []
    }
  ],
  ...overrides
});

const accountRefs = new Map<string, Qbo.Ref>([
  ["acct_travel", { value: "61" }],
  ["acct_meals", { value: "62" }],
  ["acct_employee_payable", { value: "21" }]
]);

describe("mapReimbursementToQboBill", () => {
  it("builds a Bill against the employee vendor with one account-based line per coding line", () => {
    const payload = mapReimbursementToQboBill({
      reimbursement: reimbursement(),
      vendorRemoteId: "qbo-vendor-77",
      accountRefsById: accountRefs
    });

    expect(payload).toMatchObject({
      VendorRef: { value: "qbo-vendor-77" },
      // The whole point: the employee payable stays segregated in QBO too,
      // instead of QBO implying the trade-AP account.
      APAccountRef: { value: "21" },
      DocNumber: "REIMB-2026-09-000001",
      // The GL date Carbon booked, not the expense date.
      TxnDate: "2026-09-20",
      Line: [
        {
          Amount: 500,
          Description: "Flights",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "61" } }
        },
        {
          Amount: 120,
          Description: "Meals",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "62" } }
        }
      ]
    });
    // Base currency: no CurrencyRef / ExchangeRate noise.
    expect(payload).not.toHaveProperty("CurrencyRef");
    expect(payload).not.toHaveProperty("ExchangeRate");
  });

  it("puts a class slot on the line and a department slot on the transaction", () => {
    const payload = mapReimbursementToQboBill({
      reimbursement: reimbursement({
        lines: [
          {
            id: "reimbl_1",
            accountId: "acct_travel",
            description: "Flights",
            amount: 500,
            sequence: 0,
            dimensions: [
              { dimensionId: "dim_cc", valueId: "cc_eng" },
              { dimensionId: "dim_loc", valueId: "loc_hq" }
            ]
          }
        ]
      }),
      vendorRemoteId: "qbo-vendor-77",
      accountRefsById: accountRefs,
      dimensions: {
        slots: [
          { dimensionId: "dim_cc", target: "class" },
          { dimensionId: "dim_loc", target: "department" }
        ],
        refsByValue: new Map([
          ["dim_cc:cc_eng", { value: "class-1" }],
          ["dim_loc:loc_hq", { value: "dept-1" }]
        ])
      }
    });

    // DepartmentRef is transaction-level on a Bill; only ClassRef is per line.
    expect(payload.DepartmentRef).toEqual({ value: "dept-1" });
    expect(payload.Line[0]?.AccountBasedExpenseLineDetail?.ClassRef).toEqual({
      value: "class-1"
    });
  });

  it("inverts the rate for a foreign-currency reimbursement (QBO quotes home per foreign)", () => {
    const payload = mapReimbursementToQboBill({
      reimbursement: reimbursement({
        currencyCode: "EUR",
        baseCurrencyCode: "USD",
        // Carbon stores foreign-per-base: 0.8 EUR per 1 USD.
        exchangeRate: 0.8
      }),
      vendorRemoteId: "qbo-vendor-77",
      accountRefsById: accountRefs
    });

    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBeCloseTo(1.25, 10);
  });

  it("warns UNMAPPED_ACCOUNTS when a coding account has no QBO ref", () => {
    try {
      mapReimbursementToQboBill({
        reimbursement: reimbursement(),
        vendorRemoteId: "qbo-vendor-77",
        accountRefsById: new Map([
          ["acct_travel", { value: "61" }],
          ["acct_employee_payable", { value: "21" }]
        ])
      });
      throw new Error("expected a JournalEntrySyncError");
    } catch (err) {
      expect(err).toBeInstanceOf(JournalEntrySyncError);
      const failure = (err as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.warning).toBe(true);
      expect(failure.metadata?.unmappedAccountIds).toEqual(["acct_meals"]);
    }
  });
});
