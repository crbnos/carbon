// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A rental early-return credit memo: what posting it books. Pure — post-memo
// loads the memo's adjustment periods and the Planned Deferral rows of their
// agreement lines, and writes the legs and rows planned here.
//
// The decision per period is the invoice path's own (`planRentalLine` with a
// negative Rent amount, then `rentalScheduleRows`): the unearned part comes
// off Deferred Revenue and shrinks the period's Planned rows with negative
// Deferral rows; whatever the period already recognized comes off Rental
// Income. A credit memo books the same entry the negative invoice line did —
// only the document changed, so it can be applied and refunded.

import type { SalesPostingAccount } from "@carbon/database/sales-posting-amounts";
import { distributeRoundingResidual, round } from "@carbon/utils";
import {
  planRentalLine,
  type RentalClassification,
  type RentalScheduleFact,
  rentalScheduleRows
} from "../post-sales-invoice/rental-posting";

/** One early-return adjustment the memo bills (`rentalBillingPeriod.memoId`). */
export type RentalCreditPeriod = {
  id: string;
  rentalAgreementLineId: string;
  periodStart: string;
  periodEnd: string;
  /** The adjustment row's amount: negative. */
  amount: number;
  classification: RentalClassification | null;
};

export type RentalCreditScheduleRow = {
  rentalAgreementLineId: string;
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  /** Negative: it shrinks the period's Planned rows. */
  amount: number;
};

export type RentalCreditPlan = {
  /** Signed credits (negative = debit) replacing the memo's reason leg. */
  legs: {
    account: "deferredRevenue" | "rentalIncome";
    accountClass: "Liability" | "Revenue";
    description: string;
    credit: number;
  }[];
  scheduleRows: RentalCreditScheduleRow[];
};

// planRentalLine returns its legs with the accounts it was given; only the
// amounts are read here, the accounts come from the account defaults.
const PLACEHOLDER_ACCOUNT: SalesPostingAccount = {
  id: "",
  class: null,
  active: true,
  isGroup: false,
  companyGroupId: ""
};

export function planRentalCredit(args: {
  /** The memo amount, in the agreement (base) currency. */
  memoAmount: number;
  /** The currency's `decimalPlaces`. */
  decimals: number;
  periods: RentalCreditPeriod[];
  /** Planned Deferral rows per agreement line. */
  plannedDeferrals: Map<string, RentalScheduleFact[]>;
  rentalAgreementId: string;
}): RentalCreditPlan {
  const { memoAmount, decimals, periods, rentalAgreementId } = args;
  if (periods.length === 0) {
    throw new Error(
      "This rental credit memo bills no early-return periods; delete it and invoice the agreement again"
    );
  }
  const credits = periods.map((period) => -period.amount);
  const total = round(
    credits.reduce((sum, value) => sum + value, 0),
    decimals
  );
  if (total !== memoAmount) {
    throw new Error(
      `This credit memo is for ${memoAmount}, but the early returns it credits come to ${total}; delete it and invoice the agreement again`
    );
  }
  // Each period's share at settlement precision, summing to the memo exactly
  // (a period cut before billing rounded to the currency kept sub-unit digits).
  const shares = distributeRoundingResidual(credits, memoAmount, decimals);

  // A copy per line, grown by every row this memo writes, so two credits on
  // one line never shrink the same Planned row twice.
  const deferrals = new Map(
    [...args.plannedDeferrals].map(([lineId, rows]) => [lineId, [...rows]])
  );
  let deferred = 0;
  let income = 0;
  const scheduleRows: RentalCreditScheduleRow[] = [];
  periods.forEach((period, index) => {
    const revenueBase = -shares[index]!;
    if (revenueBase === 0) return;
    const facts = deferrals.get(period.rentalAgreementLineId) ?? [];
    const plan = planRentalLine({
      lineType: "Rent",
      classification: period.classification,
      revenueBase,
      period: { periodStart: period.periodStart, periodEnd: period.periodEnd },
      unbilledAccruals: [],
      plannedDeferrals: facts,
      accounts: {
        deferredRevenue: PLACEHOLDER_ACCOUNT,
        contractAsset: PLACEHOLDER_ACCOUNT,
        rentalIncome: PLACEHOLDER_ACCOUNT
      },
      rentalAgreementId
    });
    // A credit's first leg is Rental Income with its amount; the deferred leg
    // takes the rest.
    const incomeAmount = plan.revenueLegs[0]?.amount ?? 0;
    const deferredAmount = round(revenueBase - incomeAmount);
    income = round(income + incomeAmount);
    deferred = round(deferred + deferredAmount);
    for (const row of rentalScheduleRows(plan.schedule, deferredAmount)) {
      const scheduleRow = {
        rentalAgreementLineId: period.rentalAgreementLineId,
        ...row
      };
      scheduleRows.push(scheduleRow);
      facts.push({ id: `${period.id}:${scheduleRows.length}`, ...row });
    }
    deferrals.set(period.rentalAgreementLineId, facts);
  });

  return {
    legs: [
      {
        account: "deferredRevenue" as const,
        accountClass: "Liability" as const,
        description: "Deferred Revenue",
        credit: deferred
      },
      {
        account: "rentalIncome" as const,
        accountClass: "Revenue" as const,
        description: "Rental Income",
        credit: income
      }
    ].filter((leg) => leg.credit !== 0),
    scheduleRows
  };
}
