// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { buildSalesPostingLines } from "@carbon/database/sales-posting-amounts";
import { expect, it } from "vitest";

import {
  leaseSettlementJournalLines,
  planRentalLine,
  purchaseOptionSettlement,
  type RentalLinePlanInput,
  rentalScheduleRows
} from "./rental-posting";

const account = (id: string, accountClass: string) => ({
  id,
  class: accountClass,
  active: true,
  isGroup: false,
  companyGroupId: "group"
});
const accounts = {
  deferredRevenue: account("deferred", "Liability"),
  contractAsset: account("contract", "Asset"),
  rentalIncome: account("rental-income", "Revenue")
};
const october = { periodStart: "2026-10-01", periodEnd: "2026-10-31" };
const input = (
  overrides: Partial<RentalLinePlanInput> = {}
): RentalLinePlanInput => ({
  kind: "Rent",
  classification: "Rental",
  revenueBase: 1500,
  period: october,
  unbilledAccruals: [],
  plannedDeferrals: [],
  accounts,
  rentalAgreementId: "agreement",
  ...overrides
});

/** Posts the plan through the real builder and returns the leg amounts and
 *  the Deferral rows the deferred leg turns into. */
const post = (plan: ReturnType<typeof planRentalLine>, unitPrice: number) => {
  const result = buildSalesPostingLines({
    line: { invoiceLineType: "Rental", quantity: 1, unitPrice },
    context: {
      companyId: "company",
      companyGroupId: "group",
      documentId: "invoice",
      journalLineReference: "reference"
    },
    accounts: { receivables: account("ar", "Asset") },
    metadata: {
      customerTypeId: null,
      itemPostingGroupId: null,
      itemId: null,
      locationId: null,
      costCenterId: null,
      fixedAssetClassId: null
    },
    revenueLegs: plan.revenueLegs
  });
  const deferred =
    result.revenueLegAmounts[result.revenueLegAmounts.length - 1]!;
  return {
    byAccount: Object.fromEntries(
      result.lines.map((line) => [line.accountId, line.amount])
    ),
    documents: result.lines.map((line) => [line.accountId, line.documentType]),
    rows: rentalScheduleRows(plan.schedule, deferred)
  };
};

it("advance rent with nothing accrued is deferred in full over its period", () => {
  const plan = planRentalLine(input());
  expect(plan.billedAccrualIds).toEqual([]);
  const posted = post(plan, 1500);
  expect(posted.byAccount).toEqual({ deferred: 1500, ar: 1500 });
  expect(posted.documents).toEqual([
    ["deferred", "Rental Agreement"],
    ["ar", "Invoice"]
  ]);
  expect(posted.rows).toEqual([
    {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      scheduledDate: "2026-10-31",
      amount: 1500
    }
  ]);
});

it("accrued rent is billed off the contract asset; the rest defers over the uncovered days", () => {
  // A 28-day period billed in arrears: October's 17 days were accrued.
  const period = { periodStart: "2026-10-15", periodEnd: "2026-11-11" };
  const plan = planRentalLine(
    input({
      period,
      unbilledAccruals: [
        {
          id: "accrual-oct",
          periodStart: "2026-10-15",
          periodEnd: "2026-10-31",
          scheduledDate: "2026-10-31",
          amount: 910.71
        },
        {
          id: "accrual-other-period",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          scheduledDate: "2026-09-30",
          amount: 1500
        }
      ]
    })
  );
  expect(plan.billedAccrualIds).toEqual(["accrual-oct"]);
  const posted = post(plan, 1500);
  expect(posted.byAccount).toEqual({
    contract: -910.71,
    deferred: 589.29,
    ar: 1500
  });
  expect(posted.rows).toEqual([
    {
      periodStart: "2026-11-01",
      periodEnd: "2026-11-11",
      scheduledDate: "2026-11-11",
      amount: 589.29
    }
  ]);
});

it("a fully accrued period bills entirely off the contract asset and defers nothing", () => {
  const plan = planRentalLine(
    input({
      unbilledAccruals: [
        {
          id: "accrual",
          ...october,
          scheduledDate: "2026-10-31",
          amount: 1500
        }
      ]
    })
  );
  const posted = post(plan, 1500);
  expect(posted.byAccount).toEqual({ contract: -1500, ar: 1500 });
  expect(posted.rows).toEqual([]);
});

it("an early-return credit comes off deferred revenue and shrinks the period's Planned rows, latest first", () => {
  const period = { periodStart: "2026-10-15", periodEnd: "2026-11-11" };
  const plan = planRentalLine(
    input({
      revenueBase: -1200,
      period,
      plannedDeferrals: [
        {
          id: "oct",
          periodStart: "2026-10-15",
          periodEnd: "2026-10-31",
          scheduledDate: "2026-10-31",
          amount: 910.71
        },
        {
          id: "nov",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-11",
          scheduledDate: "2026-11-11",
          amount: 589.29
        },
        {
          // Another period's row is never touched.
          id: "later",
          periodStart: "2026-11-12",
          periodEnd: "2026-11-30",
          scheduledDate: "2026-11-30",
          amount: 1000
        }
      ]
    })
  );
  const posted = post(plan, -1200);
  expect(posted.byAccount).toEqual({ deferred: -1200, ar: -1200 });
  expect(posted.rows).toEqual([
    {
      periodStart: "2026-11-01",
      periodEnd: "2026-11-11",
      scheduledDate: "2026-11-11",
      amount: -589.29
    },
    {
      periodStart: "2026-10-15",
      periodEnd: "2026-10-31",
      scheduledDate: "2026-10-31",
      amount: -610.71
    }
  ]);
});

it("an early-return credit on rent already recognized comes off rental income", () => {
  // October's row is Posted (not offered); only 300 is still Planned.
  const plan = planRentalLine(
    input({
      revenueBase: -1200,
      plannedDeferrals: [
        {
          id: "oct-rest",
          ...october,
          scheduledDate: "2026-10-31",
          amount: 300
        }
      ]
    })
  );
  const posted = post(plan, -1200);
  expect(posted.byAccount).toEqual({
    "rental-income": -900,
    deferred: -300,
    ar: -1200
  });
  expect(posted.rows).toEqual([
    {
      ...october,
      scheduledDate: "2026-10-31",
      amount: -300
    }
  ]);

  const nothingPlanned = post(
    planRentalLine(input({ revenueBase: -1200 })),
    -1200
  );
  expect(nothingPlanned.byAccount).toEqual({
    "rental-income": -1200,
    ar: -1200
  });
  expect(nothingPlanned.rows).toEqual([]);
});

it("a charge is rental income when billed, with no schedule", () => {
  const plan = planRentalLine(
    input({ kind: "Charge", period: null, revenueBase: 250 })
  );
  const posted = post(plan, 250);
  expect(posted.byAccount).toEqual({ "rental-income": 250, ar: 250 });
  expect(posted.rows).toEqual([]);
});

const salesType = (overrides: Partial<RentalLinePlanInput> = {}) =>
  input({
    classification: "Sale",
    accounts: {
      ...accounts,
      netInvestmentInLeases: account("net-investment", "Asset")
    },
    ...overrides
  });

it("sales-type rent collects the net investment in full, with no schedule and no accrual", () => {
  // Spec pin: the month-1 invoice posts Dr AR 1,000 / Cr 1160 1,000.
  const plan = planRentalLine(
    salesType({
      revenueBase: 1000,
      unbilledAccruals: [
        {
          id: "stray-accrual",
          ...october,
          scheduledDate: "2026-10-31",
          amount: 1000
        }
      ]
    })
  );
  expect(plan.billedAccrualIds).toEqual([]);
  expect(plan.schedule).toEqual(null);
  const posted = post(plan, 1000);
  expect(posted.byAccount).toEqual({ "net-investment": -1000, ar: 1000 });
  expect(posted.documents).toEqual([
    ["net-investment", "Rental Agreement"],
    ["ar", "Invoice"]
  ]);
  expect(posted.rows).toEqual([]);
});

it("an exercised purchase option collects the net investment and needs no period", () => {
  const plan = planRentalLine(
    salesType({
      kind: "Purchase Option",
      period: null,
      revenueBase: 5000
    })
  );
  const posted = post(plan, 5000);
  expect(posted.byAccount).toEqual({ "net-investment": -5000, ar: 5000 });
  expect(posted.rows).toEqual([]);
});

it("a charge on a sales-type lease is rental income when billed", () => {
  const plan = planRentalLine(
    salesType({ kind: "Charge", period: null, revenueBase: 250 })
  );
  const posted = post(plan, 250);
  expect(posted.byAccount).toEqual({ "rental-income": 250, ar: 250 });
  expect(posted.rows).toEqual([]);
});

it("sales-type credits, an unmapped net investment account and direct financing are refused", () => {
  expect(() => planRentalLine(salesType({ revenueBase: -1000 }))).toThrow(
    "Early-return credits do not apply to a rental treated as a sale"
  );
  expect(() => planRentalLine(input({ classification: "Sale" }))).toThrow(
    "Net Investment in Leases account"
  );
  expect(() => planRentalLine(input({ classification: "Financing" }))).toThrow(
    "Financing"
  );
});

it("purchase options on operating lines and rent without a period are refused", () => {
  expect(() => planRentalLine(input({ kind: "Purchase Option" }))).toThrow(
    "Purchase option billing requires a line treated as a sale"
  );
  expect(() =>
    planRentalLine(input({ kind: "Purchase Option", classification: null }))
  ).toThrow("Purchase option billing requires a line treated as a sale");
  expect(() => planRentalLine(input({ period: null }))).toThrow(
    "billing period"
  );
});

const netInvestment = account("net-investment", "Asset");
const settlementAccounts = {
  netInvestmentInLeases: netInvestment,
  costOfGoodsSold: account("cogs", "Expense"),
  leaseRevenue: account("lease-revenue", "Revenue")
};

/** Posts an exercised purchase option the way post-sales-invoice does: the
 *  line's charges through the real builder, then the settlement legs on the
 *  same journal line reference. Returns the net amount per account. */
const exercise = (closingTarget: number, optionAmount: number) => {
  const plan = planRentalLine(
    salesType({
      kind: "Purchase Option",
      period: null,
      revenueBase: optionAmount
    })
  );
  const charges = buildSalesPostingLines({
    line: { invoiceLineType: "Rental", quantity: 1, unitPrice: optionAmount },
    context: {
      companyId: "company",
      companyGroupId: "group",
      documentId: "invoice",
      journalLineReference: "reference"
    },
    accounts: { receivables: account("ar", "Asset") },
    metadata: {
      customerTypeId: null,
      itemPostingGroupId: null,
      itemId: null,
      locationId: null,
      costCenterId: null,
      fixedAssetClassId: null
    },
    revenueLegs: plan.revenueLegs
  });
  const settlement = leaseSettlementJournalLines(
    purchaseOptionSettlement({
      closingTarget,
      optionAmount: charges.revenueLegAmounts[0]!,
      accounts: settlementAccounts,
      rentalAgreementId: "agreement"
    }),
    { companyId: "company", quantity: 1, journalLineReference: "reference" }
  );
  const byAccount: Record<string, number> = {};
  for (const line of [...charges.lines, ...settlement]) {
    byAccount[line.accountId] = (byAccount[line.accountId] ?? 0) + line.amount;
  }
  // Natural-balance signed: an Asset / Expense amount is a debit, a Revenue
  // one a credit, so the settlement's signed debits must net to zero.
  const debitSide = new Set(["net-investment", "cogs", "ar"]);
  const signedDebits = settlement.reduce(
    (sum, line) =>
      sum + (debitSide.has(line.accountId) ? line.amount : -line.amount),
    0
  );
  expect(signedDebits).toEqual(0);
  return { settlement, byAccount };
};

it("an option equal to the schedule's closing balance clears the net investment with no extra legs", () => {
  // Option reasonably certain, no residual: the schedule closes on the option.
  const { settlement, byAccount } = exercise(5000, 5000);
  expect(settlement).toEqual([]);
  expect(byAccount).toEqual({ "net-investment": -5000, ar: 5000 });
});

it("an option below the closing balance expenses the unrecovered residual to COGS and clears the net investment", () => {
  // The option was not reasonably certain; the schedule closes on an 8,000
  // unguaranteed residual and the lessee buys the unit for 5,000.
  const { settlement, byAccount } = exercise(8000, 5000);
  expect(
    settlement.map((line) => [
      line.accountId,
      line.amount,
      line.documentType,
      line.documentId,
      line.journalLineReference
    ])
  ).toEqual([
    ["cogs", 3000, "Rental Agreement", "agreement", "reference"],
    ["net-investment", -3000, "Rental Agreement", "agreement", "reference"]
  ]);
  // Net Investment is credited 5,000 + 3,000 = the 8,000 it carried.
  expect(byAccount).toEqual({ "net-investment": -8000, ar: 5000, cogs: 3000 });
});

it("an option above the closing balance is a lease revenue gain on the excess", () => {
  const { settlement, byAccount } = exercise(5000, 6000);
  expect(
    settlement.map((line) => [line.accountId, line.amount, line.documentType])
  ).toEqual([
    ["net-investment", 1000, "Rental Agreement"],
    ["lease-revenue", 1000, "Rental Agreement"]
  ]);
  // Net Investment: −6,000 billed + 1,000 back = the 5,000 it carried.
  expect(byAccount).toEqual({
    "net-investment": -5000,
    ar: 6000,
    "lease-revenue": 1000
  });
});

it("a settlement that needs an unmapped or invalid account is refused", () => {
  expect(() =>
    purchaseOptionSettlement({
      closingTarget: 8000,
      optionAmount: 5000,
      accounts: { netInvestmentInLeases: netInvestment, costOfGoodsSold: null },
      rentalAgreementId: "agreement"
    })
  ).toThrow("Cost of Goods Sold account");
  expect(() =>
    purchaseOptionSettlement({
      closingTarget: 5000,
      optionAmount: 6000,
      accounts: {
        netInvestmentInLeases: netInvestment,
        leaseRevenue: account("lease-revenue", "Liability")
      },
      rentalAgreementId: "agreement"
    })
  ).toThrow("Lease Revenue account");
  // An account the settlement does not use is never required.
  expect(
    purchaseOptionSettlement({
      closingTarget: 5000,
      optionAmount: 5000,
      accounts: { netInvestmentInLeases: netInvestment },
      rentalAgreementId: "agreement"
    })
  ).toEqual([]);
});
