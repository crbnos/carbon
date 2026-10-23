// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The service job's rules: its coverage account, the suggested coverage, the
// estimate gate and the header's primary action. Pure, so the ERP, the MES and
// the postings agree.
// Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md`

import type { Database } from "@carbon/database";
import { equals, round } from "@carbon/database/precision";

type Enums = Database["public"]["Enums"];
type ServiceJobStatus = Enums["serviceJobStatus"];
type ServiceCoverage = Enums["serviceCoverage"];
type ServiceBillingMethod = Enums["serviceBillingMethod"];
type ServiceEstimateStatus = Enums["serviceEstimateStatus"];

/** A Completed, Invoiced or Cancelled job takes no more edits. */
export const SERVICE_JOB_LOCKED_STATUSES = [
  "Completed",
  "Invoiced",
  "Cancelled"
] as const satisfies readonly ServiceJobStatus[];

export function isServiceJobLocked(status: string | null | undefined): boolean {
  return SERVICE_JOB_LOCKED_STATUSES.includes(
    status as (typeof SERVICE_JOB_LOCKED_STATUSES)[number]
  );
}

/**
 * The account default a job's cost goes to. Billable and Contract work is a
 * cost of service (which falls back to COGS); Warranty work is warranty
 * expense.
 */
export function coverageAccountRole(
  coverage: ServiceCoverage
): "costOfServiceAccount" | "warrantyExpenseAccount" {
  return coverage === "Warranty"
    ? "warrantyExpenseAccount"
    : "costOfServiceAccount";
}

/**
 * The coverage a new job on an asset starts with: Warranty while the labor or
 * the parts warranty runs on `asOfDate`, else Billable. Dates are
 * `YYYY-MM-DD`, so string order is calendar order.
 */
export function suggestCoverage(
  asset: {
    laborWarrantyEndDate: string | null;
    partsWarrantyEndDate: string | null;
  },
  asOfDate: string
): "Warranty" | "Billable" {
  const runs = (endDate: string | null) => !!endDate && endDate >= asOfDate;
  return runs(asset.laborWarrantyEndDate) || runs(asset.partsWarrantyEndDate)
    ? "Warranty"
    : "Billable";
}

export const warrantyStatuses = [
  "In warranty",
  "Labor ended",
  "Expired"
] as const;
export type WarrantyStatus = (typeof warrantyStatuses)[number];

/**
 * The warranty of a customer asset on a day (`YYYY-MM-DD`; date strings
 * compare in calendar order). In warranty while the labor warranty runs,
 * Labor ended while only the parts warranty runs, else Expired.
 */
export function warrantyStatus(
  asset: {
    laborWarrantyEndDate: string | null;
    partsWarrantyEndDate: string | null;
  },
  today: string
): WarrantyStatus {
  if (asset.laborWarrantyEndDate && asset.laborWarrantyEndDate >= today) {
    return "In warranty";
  }
  if (asset.partsWarrantyEndDate && asset.partsWarrantyEndDate >= today) {
    return "Labor ended";
  }
  return "Expired";
}

export type ServiceJobRuleFields = {
  status: ServiceJobStatus;
  coverage: ServiceCoverage;
  billingMethod: ServiceBillingMethod;
  salesReturnOrderLineId: string | null;
  repairable: boolean | null;
  estimateStatus: ServiceEstimateStatus | null;
};

/**
 * True when the job needs an accepted estimate before it completes: a Fixed
 * Price job, or a Billable job from an RMA line (a Return for Service line).
 * A job found not repairable completes without one, so its evaluation time
 * can be billed. Warranty and Contract jobs never need one.
 */
export function needsAcceptedEstimate(
  job: Pick<
    ServiceJobRuleFields,
    "coverage" | "billingMethod" | "salesReturnOrderLineId" | "repairable"
  >
): boolean {
  if (job.repairable === false) return false;
  if (job.coverage !== "Billable") return false;
  return job.billingMethod === "Fixed Price" || !!job.salesReturnOrderLineId;
}

/** False while the job needs an accepted estimate and has none. */
export function canComplete(
  job: Pick<
    ServiceJobRuleFields,
    | "coverage"
    | "billingMethod"
    | "salesReturnOrderLineId"
    | "repairable"
    | "estimateStatus"
  >
): boolean {
  return !needsAcceptedEstimate(job) || job.estimateStatus === "Accepted";
}

export type ServiceJobPrimaryAction =
  | "Start"
  | "Send Estimate"
  | "Complete"
  | "Record Response"
  | "Create Invoice";

/**
 * The one primary action of the job page header, by status and coverage. Every
 * other action (Reopen, Hold, Cancel, Print Estimate) is in the ⋯ menu.
 */
export function serviceJobPrimaryAction(
  job: ServiceJobRuleFields
): ServiceJobPrimaryAction | null {
  switch (job.status) {
    case "Open":
      return "Start";
    case "In Progress":
      return canComplete(job) ? "Complete" : "Send Estimate";
    case "Awaiting Approval":
      return job.coverage === "Billable" ? "Record Response" : null;
    case "Completed":
      return job.coverage === "Billable" ? "Create Invoice" : null;
    default:
      return null;
  }
}

// --- My Time ----------------------------------------------------------------

/** The job a My Time service row names. */
export type ServiceTimeRowJob = {
  id: string;
  /** The readable job number ("SJ000012"). */
  serviceJobId: string;
  status: ServiceJobStatus;
  customerName: string | null;
};

/** One day of a service row: the hours, and how many came from the clock. */
export type ServiceTimeCell = {
  hours: number;
  clockHours: number;
  /** The day's first entry: a day stacks its bars in that order. */
  createdAt: string;
};

export type ServiceTimeRow = ServiceTimeRowJob & {
  isLocked: boolean;
  cells: Record<string, ServiceTimeCell>;
  total: number;
};

/**
 * The service rows of one employee's My Time week: one row per job, each
 * day the sum of the job's entries on it, plus a row with no hours for a job
 * the employee is assigned to that week and has no time on. Rows are in job
 * number order. A clock entry is one with a `startTime`.
 */
export function groupServiceTimeRows(
  entries: {
    entryDate: string;
    hours: number;
    startTime: string | null;
    createdAt: string;
    job: ServiceTimeRowJob;
  }[],
  assignments: { job: ServiceTimeRowJob }[]
): ServiceTimeRow[] {
  const rows = new Map<string, ServiceTimeRow>();
  const rowOf = (job: ServiceTimeRowJob) => {
    let row = rows.get(job.id);
    if (!row) {
      row = {
        ...job,
        isLocked: isServiceJobLocked(job.status),
        cells: {},
        total: 0
      };
      rows.set(job.id, row);
    }
    return row;
  };

  for (const entry of entries) {
    const row = rowOf(entry.job);
    const hours = Number(entry.hours) || 0;
    const cell = row.cells[entry.entryDate];
    row.cells[entry.entryDate] = {
      hours: (cell?.hours ?? 0) + hours,
      clockHours: (cell?.clockHours ?? 0) + (entry.startTime ? hours : 0),
      createdAt:
        cell && cell.createdAt <= entry.createdAt
          ? cell.createdAt
          : entry.createdAt
    };
    row.total += hours;
  }
  for (const assignment of assignments) rowOf(assignment.job);

  return [...rows.values()].sort((a, b) =>
    a.serviceJobId.localeCompare(b.serviceJobId)
  );
}

/**
 * The hours of the day's one manual entry (no clock) when the employee sets
 * the day's total for a job on My Time: the new total less the day's clock
 * entries. Null when the total is below the clock entries: those are edited
 * on the job, never here. 0 means the manual entry goes.
 */
export function manualHoursForDay(
  dayEntries: { hours: number; startTime: string | null }[],
  total: number
): number | null {
  const clockHours = dayEntries.reduce(
    (sum, entry) => sum + (entry.startTime ? Number(entry.hours) || 0 : 0),
    0
  );
  const manual = total - clockHours;
  if (equals(manual, 0)) return 0;
  return manual < 0 ? null : round(manual);
}
