// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal lines a service job posts, pure: the coverage account its cost
// goes to, the completion journal (labor), and the reclass a coverage change
// writes for the parts already issued. `postServiceJob` and the `serviceJob*`
// issue types (`service.service.ts`, `inventory.service.ts`) read the
// database and write what this returns.
// Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md` → Postings.

import { InvalidInputError } from "@carbon/api/errors";
import type { Database } from "@carbon/database";
import {
  type AutomaticJournalStatus,
  type OptionalDefaultRole,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import {
  coverageAccountRole,
  credit,
  debit,
  EPSILON,
  round
} from "@carbon/utils";

type ServiceCoverage = Database["public"]["Enums"]["serviceCoverage"];

/** The account defaults a service job posting reads. */
export type ServiceJobAccountDefaults = {
  costOfServiceAccount: string | null;
  costOfGoodsSoldAccount: string;
  warrantyExpenseAccount: string | null;
  laborAbsorptionAccount: string | null;
  retainedEarningsAccount: string;
};

/** "Set the Warranty Expense account in Accounting → Default Accounts." */
export const MISSING_WARRANTY_EXPENSE_ACCOUNT =
  "Set the Warranty Expense account in Accounting → Default Accounts.";

/**
 * The account a job's cost goes to. Billable and Contract work is a cost of
 * service, which falls back to Cost of Goods Sold. Warranty work is warranty
 * expense: a feature default with no fallback and no stand-in, so an empty
 * one refuses the posting in every company state.
 */
export function serviceCoverageAccount(
  defaults: Pick<
    ServiceJobAccountDefaults,
    | "costOfServiceAccount"
    | "costOfGoodsSoldAccount"
    | "warrantyExpenseAccount"
    | "retainedEarningsAccount"
  >,
  coverage: ServiceCoverage,
  postingStatus: AutomaticJournalStatus
): string {
  if (coverageAccountRole(coverage) === "warrantyExpenseAccount") {
    if (!defaults.warrantyExpenseAccount) {
      throw new InvalidInputError(MISSING_WARRANTY_EXPENSE_ACCOUNT);
    }
    return defaults.warrantyExpenseAccount;
  }
  return resolveDefaultAccount(defaults, "costOfServiceAccount", postingStatus)
    .accountId;
}

/** What the coverage account's line is called in the journal. */
export function coverageLineDescription(coverage: ServiceCoverage): string {
  return coverage === "Warranty" ? "Warranty Expense" : "Cost of Service";
}

/** A journal line the posting writes, amount signed by the journal's
 *  convention (a debit to an expense account is positive). */
export type ServiceJobJournalLine = {
  accountId: string;
  description: string;
  amount: number;
  /** Set on a Provisional stand-in line that the cutover re-points. */
  accountDefaultRole: OptionalDefaultRole | null;
};

/** A time entry, with its labor item's cost per hour. */
export type ServiceJobTimeCost = {
  laborItemId: string;
  laborItemName: string;
  hours: number;
  unitCost: number;
};

/**
 * The completion journal: one pair per labor item, Dr the coverage account /
 * Cr labor absorption, at Σ hours × the item's cost per hour. A labor item
 * whose entries cost nothing writes no pair. Returns no lines when the job's
 * time costs nothing.
 */
export function buildServiceJobCompletionLines(args: {
  coverage: ServiceCoverage;
  coverageAccountId: string;
  laborAbsorption: {
    accountId: string;
    accountDefaultRole: OptionalDefaultRole | null;
  };
  time: ServiceJobTimeCost[];
}): { lines: ServiceJobJournalLine[]; total: number } {
  const byItem = new Map<string, { name: string; cost: number }>();
  for (const entry of args.time) {
    const current = byItem.get(entry.laborItemId) ?? {
      name: entry.laborItemName,
      cost: 0
    };
    current.cost += Number(entry.hours) * Number(entry.unitCost);
    byItem.set(entry.laborItemId, current);
  }

  const lines: ServiceJobJournalLine[] = [];
  let total = 0;
  for (const { name, cost: exact } of byItem.values()) {
    const cost = round(exact);
    if (cost < EPSILON) continue;
    total += cost;
    lines.push(
      {
        accountId: args.coverageAccountId,
        description: `${coverageLineDescription(args.coverage)}: ${name}`,
        amount: debit("expense", cost),
        accountDefaultRole: null
      },
      {
        accountId: args.laborAbsorption.accountId,
        description: `Labor Absorption: ${name}`,
        amount: credit("expense", cost),
        accountDefaultRole: args.laborAbsorption.accountDefaultRole
      }
    );
  }
  return { lines, total: round(total) };
}

/**
 * The parts reclass a coverage change writes: Dr the new coverage account /
 * Cr the old one, at what the job's issued parts cost net of returns. No lines
 * when nothing is expensed or both coverages post to one account.
 */
export function buildCoverageReclassLines(args: {
  from: { coverage: ServiceCoverage; accountId: string };
  to: { coverage: ServiceCoverage; accountId: string };
  partsCost: number;
}): ServiceJobJournalLine[] {
  const cost = round(args.partsCost);
  if (Math.abs(cost) < EPSILON) return [];
  if (args.from.accountId === args.to.accountId) return [];
  return [
    {
      accountId: args.to.accountId,
      description: `${coverageLineDescription(args.to.coverage)}: parts reclass`,
      amount: debit("expense", cost),
      accountDefaultRole: null
    },
    {
      accountId: args.from.accountId,
      description: `${coverageLineDescription(args.from.coverage)}: parts reclass`,
      amount: credit("expense", cost),
      accountDefaultRole: null
    }
  ];
}
