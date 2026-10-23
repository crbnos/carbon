// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The service job's rules: its coverage account, the suggested coverage, the
// estimate gate and the header's primary action. Pure, so the ERP, the MES and
// the postings agree.
// Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md`

import type { Database } from "@carbon/database";

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
