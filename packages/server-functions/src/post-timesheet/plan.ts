// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure planner for timesheet postings. Each entry costs hours × its labor
// category's rate on the entry date (a reversal reuses the rate its original
// posted at), and posts Dr the project account / Cr labor absorption. A
// Statistical project posts nothing: the entry is only stamped Posted.
// The journal is Provisional before the company's accounting cutover and
// Posted after it; an empty laborAbsorptionAccount becomes a stand-in line
// before the cutover and refuses the posting after it (resolveDefaultAccount).
// In DCAA mode an exempt employee's week is diluted (`planDilution`): each
// entry costs hours × rate × the week's factor, and a later change to the
// week re-dilutes its posted entries by posting the difference.
// Spec: .ai/specs/2026-10-03-projects.md (Charging: the five entry points);
// .ai/specs/2026-10-09-government-contracting.md (Dilution for exempt staff).

import {
  type AutomaticJournalStatus,
  type OptionalDefaultRole,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
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
  /** A stand-in line names the default it wanted (resolveDefaultAccount). */
  accountDefaultRole: OptionalDefaultRole | null;
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
  /** The dilution factor the entry posted at; absent when not diluted. */
  dilutionFactor?: number;
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

/** The cost and the stamped rate of `hours` at `rate` diluted by `factor`. */
export function dilutedCost(
  hours: number,
  rate: number,
  factor: number
): { cost: number; costRate: number } {
  return { cost: round(hours * rate * factor), costRate: round(rate * factor) };
}

/** A posted entry of a diluted week, with what its ledger rows hold now. */
export type DilutionPostedEntry = {
  id: string;
  hours: number;
  costRate: number;
  dilutionFactor: number | null;
  /** Σ projectLedger.amount of the entry (documentType Timesheet). */
  postedAmount: number;
};

/**
 * The dilution of one (employee, week) at `factor` (CAM 6-410.4a):
 * - `costs`: each new entry costs hours × rate × factor, stamped at
 *   rate × factor;
 * - `adjustments` and `stamps`: each posted entry is re-costed at its base
 *   rate (costRate ÷ its own factor) × the new factor. A difference from what
 *   it posted is an adjustment, and its rate and factor are stamped again.
 */
export function planDilution(
  entries: { id: string; hours: number; rate: number }[],
  posted: DilutionPostedEntry[],
  factor: number
): {
  costs: { entryId: string; cost: number; costRate: number }[];
  adjustments: { entryId: string; amount: number }[];
  stamps: { entryId: string; costRate: number; dilutionFactor: number }[];
} {
  const costs = entries.map((entry) => ({
    entryId: entry.id,
    ...dilutedCost(entry.hours, entry.rate, factor)
  }));
  const adjustments: { entryId: string; amount: number }[] = [];
  const stamps: {
    entryId: string;
    costRate: number;
    dilutionFactor: number;
  }[] = [];
  for (const entry of posted) {
    const baseRate = entry.costRate / (entry.dilutionFactor ?? 1);
    const target = dilutedCost(entry.hours, baseRate, factor);
    const difference = round(target.cost - entry.postedAmount);
    if (difference !== 0) {
      adjustments.push({ entryId: entry.id, amount: difference });
    }
    stamps.push({
      entryId: entry.id,
      costRate: target.costRate,
      dilutionFactor: factor
    });
  }
  return { costs, adjustments, stamps };
}

/**
 * Plans every timesheet posting of one call. `dilutionFactors` holds the
 * week's factor of each new entry an exempt employee records in DCAA mode;
 * `restrictCharging` checks the employee against the project's members
 * (DCAA charge restrictions). Both are off in Standard mode.
 */
export type TimesheetJournalOptions = {
  postingStatus: AutomaticJournalStatus;
  accountDefaults: {
    laborAbsorptionAccount: string | null;
    retainedEarningsAccount: string;
  };
};

export function planTimesheetPosting(
  entries: TimesheetPostingEntry[],
  contexts: Map<string, ProjectPostingContext>,
  rates: TimesheetLaborRate[],
  originals: Map<string, TimesheetOriginal>,
  options: TimesheetJournalOptions & {
    dilutionFactors?: Map<string, number>;
    restrictCharging?: boolean;
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
    // A reversal is never refused for membership: it undoes posted time.
    assertChargeable(
      ctx,
      entry.reversalOfId ? "commitment" : "new",
      options.restrictCharging && !entry.reversalOfId
        ? entry.employeeId
        : undefined
    );

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

    const rate =
      original?.costRate ??
      laborRateOn(rates, entry.laborCategoryId, entry.entryDate)?.costRate ??
      null;
    // A reversal keeps its original's (already diluted) rate.
    const factor = entry.reversalOfId
      ? undefined
      : options.dilutionFactors?.get(entry.id);
    const diluted =
      rate !== null && factor !== undefined
        ? dilutedCost(entry.hours, rate, factor)
        : null;
    const costRate = diluted ? diluted.costRate : rate;
    const dilution = diluted ? { dilutionFactor: factor } : {};

    if (treatment === "Statistical" || accountId === null) {
      plan.stamps.push({ entryId: entry.id, costRate, treatment, ...dilution });
      continue;
    }

    if (rate === null || costRate === null) {
      throw new ProjectChargeError(
        `The labor category of a timesheet entry has no cost rate on ${entry.entryDate}`
      );
    }

    const cost = diluted ? diluted.cost : round(entry.hours * rate);
    plan.stamps.push({ entryId: entry.id, costRate, treatment, ...dilution });
    pushCost(plan, {
      entry,
      ctx,
      resolved: { treatment, accountId, fixedAssetId, postCapitalization },
      quantity: entry.hours,
      cost,
      reversalOfId: original?.ledgerRowId ?? null,
      options
    });
  }

  return plan;
}

/**
 * The ledger row and the journal lines of one timesheet cost: Dr the project
 * account / Cr labor absorption, with no journal lines for a 0 cost.
 */
function pushCost(
  plan: Pick<TimesheetPostingPlan, "lines" | "ledgerRows">,
  args: {
    entry: TimesheetPostingEntry;
    ctx: ProjectPostingContext;
    resolved: {
      treatment: ProjectCostTreatment;
      accountId: string;
      fixedAssetId: string | null;
      postCapitalization: boolean;
    };
    quantity: number;
    cost: number;
    reversalOfId: string | null;
    options: TimesheetJournalOptions;
  }
): void {
  const { entry, ctx, resolved, cost, options } = args;
  const { treatment, accountId } = resolved;
  plan.ledgerRows.push({
    entryId: entry.id,
    projectId: entry.projectId,
    projectElementId: entry.projectElementId,
    postingDate: entry.entryDate,
    employeeId: entry.employeeId,
    laborCategoryId: entry.laborCategoryId,
    quantity: args.quantity,
    amount: cost,
    reversalOfId: args.reversalOfId,
    fixedAssetId: resolved.fixedAssetId,
    postCapitalization: resolved.postCapitalization,
    coverage: treatment === "By Coverage" ? (entry.coverage ?? null) : null,
    coverageReason:
      treatment === "By Coverage" ? (entry.coverageReason ?? null) : null,
    unallowable: isUnallowableCharge(ctx, accountId)
  });

  if (cost === 0) return;
  const absorption = resolveDefaultAccount(
    options.accountDefaults,
    "laborAbsorptionAccount",
    options.postingStatus
  );

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
      accountDefaultRole: null,
      isProjectDebit: true
    },
    {
      ...shared,
      accountId: absorption.accountId,
      description: "Labor Absorption",
      amount: credit("expense", cost),
      accountDefaultRole: absorption.accountDefaultRole,
      isProjectDebit: false
    }
  );
}

/**
 * The postings of re-dilution adjustments: for each posted entry whose
 * diluted cost changed, a ledger row of the difference with quantity 0 and
 * the journal lines of the entry's own account, lines and dimensions. A
 * Statistical entry posts nothing.
 */
export function planRedilutionPostings(
  adjustments: { entry: TimesheetPostingEntry; amount: number }[],
  contexts: Map<string, ProjectPostingContext>,
  options: TimesheetJournalOptions
): Pick<TimesheetPostingPlan, "lines" | "ledgerRows"> {
  const plan: Pick<TimesheetPostingPlan, "lines" | "ledgerRows"> = {
    lines: [],
    ledgerRows: []
  };
  for (const { entry, amount } of adjustments) {
    const ctx = contexts.get(
      projectPostingKey(entry.projectId, entry.projectElementId)
    );
    if (!ctx) {
      throw new ProjectChargeError(
        "The project or element of a timesheet entry does not exist"
      );
    }
    const resolved = resolveProjectPostingAccount(
      ctx,
      entry.entryDate,
      entry.coverage
    );
    if (resolved.treatment === "Statistical" || resolved.accountId === null) {
      continue;
    }
    pushCost(plan, {
      entry,
      ctx,
      resolved: { ...resolved, accountId: resolved.accountId },
      quantity: 0,
      cost: amount,
      reversalOfId: null,
      options
    });
  }
  return plan;
}
