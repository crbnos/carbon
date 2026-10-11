// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure planner for timesheet postings. Each entry costs hours × its labor
// category's rate on the entry date (a reversal reuses the rate its original
// posted at), and posts Dr the project account / Cr labor absorption. A
// Statistical project posts nothing: the entry is only stamped Posted.
// Spec: .ai/specs/2026-10-03-projects.md (Charging: the five entry points).

import { credit, debit, round, type ServiceCoverage } from "@carbon/utils";
import {
  assertChargeable,
  isUnallowableCharge,
  ProjectChargeError,
  type ProjectCostTreatment,
  type ProjectPostingContext,
  projectPostingKey,
  resolveProjectPostingAccount
} from "../lib/project-posting";

export type TimesheetPostingEntry = {
  id: string;
  employeeId: string;
  entryDate: string; // YYYY-MM-DD
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  hours: number;
  reversalOfId: string | null;
  /** A Service project's entry: who pays for it (decides the account). */
  coverage?: ServiceCoverage | null;
  coverageReason?: string | null;
  /** A Service project's customer, for the Customer dimension. */
  customerId?: string | null;
};

export type TimesheetLaborRate = {
  laborCategoryId: string;
  effectiveFrom: string; // YYYY-MM-DD
  costRate: number;
};

/** The entry a reversal reverses, and the ledger row it posted. */
export type TimesheetOriginal = {
  id: string;
  costRate: number | null;
  ledgerRowId: string | null;
};

export type TimesheetJournalLine = {
  entryId: string;
  postingDate: string;
  accountId: string;
  description: string;
  amount: number; // natural-balance signed, journalLine convention
  isProjectDebit: boolean;
  projectId: string;
  projectElementId: string | null;
  employeeId: string;
  customerId: string | null;
};

export type TimesheetLedgerRow = {
  entryId: string;
  projectId: string;
  projectElementId: string | null;
  postingDate: string;
  employeeId: string;
  laborCategoryId: string;
  quantity: number;
  amount: number;
  reversalOfId: string | null;
  /** The asset a Capitalize entry builds, else null. */
  fixedAssetId: string | null;
  postCapitalization: boolean;
  coverage: ServiceCoverage | null;
  coverageReason: string | null;
  /** `isUnallowableCharge` for the project account. */
  unallowable: boolean;
};

export type TimesheetStamp = {
  entryId: string;
  costRate: number | null;
  treatment: ProjectCostTreatment;
};

export type TimesheetPostingPlan = {
  lines: TimesheetJournalLine[];
  ledgerRows: TimesheetLedgerRow[];
  stamps: TimesheetStamp[];
};

/** The rate in effect on `date`: the latest `effectiveFrom` on or before it. */
export function laborRateOn(
  rates: TimesheetLaborRate[],
  laborCategoryId: string,
  date: string
): TimesheetLaborRate | null {
  let best: TimesheetLaborRate | null = null;
  for (const rate of rates) {
    if (rate.laborCategoryId !== laborCategoryId) continue;
    if (rate.effectiveFrom > date) continue;
    if (!best || rate.effectiveFrom > best.effectiveFrom) best = rate;
  }
  return best;
}

export function planTimesheetPosting(
  entries: TimesheetPostingEntry[],
  contexts: Map<string, ProjectPostingContext>,
  rates: TimesheetLaborRate[],
  originals: Map<string, TimesheetOriginal>,
  options: {
    accountingEnabled: boolean;
    laborAbsorptionAccount: string | null;
  }
): TimesheetPostingPlan {
  const plan: TimesheetPostingPlan = { lines: [], ledgerRows: [], stamps: [] };

  for (const entry of entries) {
    const ctx = contexts.get(
      projectPostingKey(entry.projectId, entry.projectElementId)
    );
    if (!ctx) {
      throw new ProjectChargeError(
        "The project or element of a timesheet entry does not exist"
      );
    }
    assertChargeable(ctx, entry.reversalOfId ? "commitment" : "new");

    const { treatment, accountId, fixedAssetId, postCapitalization } =
      resolveProjectPostingAccount(ctx, entry.entryDate, entry.coverage);

    const original = entry.reversalOfId
      ? originals.get(entry.reversalOfId)
      : undefined;
    if (entry.reversalOfId && !original) {
      throw new ProjectChargeError(
        "The entry this correction reverses does not exist"
      );
    }

    const costRate =
      original?.costRate ??
      laborRateOn(rates, entry.laborCategoryId, entry.entryDate)?.costRate ??
      null;

    if (treatment === "Statistical" || accountId === null) {
      plan.stamps.push({ entryId: entry.id, costRate, treatment });
      continue;
    }

    if (costRate === null) {
      throw new ProjectChargeError(
        `The labor category of a timesheet entry has no cost rate on ${entry.entryDate}`
      );
    }

    const cost = round(entry.hours * costRate);
    plan.stamps.push({ entryId: entry.id, costRate, treatment });
    plan.ledgerRows.push({
      entryId: entry.id,
      projectId: entry.projectId,
      projectElementId: entry.projectElementId,
      postingDate: entry.entryDate,
      employeeId: entry.employeeId,
      laborCategoryId: entry.laborCategoryId,
      quantity: entry.hours,
      amount: cost,
      reversalOfId: original?.ledgerRowId ?? null,
      fixedAssetId,
      postCapitalization,
      coverage: treatment === "By Coverage" ? (entry.coverage ?? null) : null,
      coverageReason:
        treatment === "By Coverage" ? (entry.coverageReason ?? null) : null,
      unallowable: isUnallowableCharge(ctx, accountId)
    });

    if (!options.accountingEnabled || cost === 0) continue;
    if (!options.laborAbsorptionAccount) {
      throw new Error(
        "laborAbsorptionAccount not configured in account defaults"
      );
    }

    const shared = {
      entryId: entry.id,
      postingDate: entry.entryDate,
      projectId: entry.projectId,
      projectElementId: entry.projectElementId,
      employeeId: entry.employeeId,
      customerId: entry.customerId ?? null
    };
    plan.lines.push(
      {
        ...shared,
        accountId,
        description:
          treatment === "By Coverage" ? "Service Labor" : "Project Labor",
        amount: debit("expense", cost),
        isProjectDebit: true
      },
      {
        ...shared,
        accountId: options.laborAbsorptionAccount,
        description: "Labor Absorption",
        amount: credit("expense", cost),
        isProjectDebit: false
      }
    );
  }

  return plan;
}
