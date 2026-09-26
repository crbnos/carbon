import {
  type CalendarDate,
  parseAbsolute,
  parseDate,
  toCalendarDate
} from "@internationalized/date";

// First Article Inspection (AS9102) — which make methods of a job need an FAI,
// and whether it is due. Pure: no I/O. Shared by the release blocker
// (`getJobReleaseReadiness`) and the generator (`createFirstArticleInspections`)
// so the two can never disagree about a part.

/** An approved FAI older than the item's last completed job by this much lapses. */
const PRODUCTION_LAPSE_YEARS = 2;

export type FirstArticleReason = "New Part" | "Production Lapse";

export type FirstArticleNeedInput = {
  companyRequiresFirstArticle: boolean;
  /** `customerShipping.requiresFirstArticle` of the job's customer. */
  customerRequiresFirstArticle: boolean;
  /** YYYY-MM-DD, company timezone. */
  today: string;
  makeMethods: {
    jobMakeMethodId: string;
    itemId: string;
    description: string;
    /** `itemInspectionDocumentAssignment` with usage 'First Article'. */
    firstArticlePlanId: string | null;
    /** `inspectionDocument.id` where `partId = itemId`. */
    partPlanIds: string[];
    /** ISO timestamp of the latest Approved FAI for the item. */
    latestApprovedAt: string | null;
    /** YYYY-MM-DD of the item's latest completed job, other jobs only. */
    lastCompletedJobDate: string | null;
    /** This job already has a First Article lot for this make method. */
    hasFirstArticleLot: boolean;
  }[];
};

export type FirstArticleNeed = {
  jobMakeMethodId: string;
  itemId: string;
  description: string;
  required: boolean;
  due: boolean;
  reason: FirstArticleReason | null;
  planId: string | null;
  /** Required and due, but no plan resolves — a release blocker. */
  blocked: boolean;
  /** Required and due with a plan — the generator creates the lot. */
  create: boolean;
};

/** A YYYY-MM-DD date, or the (UTC) calendar day of an ISO timestamp. */
function toDay(value: string): CalendarDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parseDate(value)
    : toCalendarDate(parseAbsolute(value, "UTC"));
}

/**
 * New Part — the item (revision) has no approved FAI.
 * Production Lapse — the item's last completed job is more than two years
 * before today and no FAI was approved after it.
 */
export function evaluateFirstArticleDue(a: {
  latestApprovedAt: string | null;
  lastCompletedJobDate: string | null;
  today: string;
}): { due: boolean; reason: FirstArticleReason | null } {
  if (!a.latestApprovedAt) return { due: true, reason: "New Part" };
  if (!a.lastCompletedJobDate) return { due: false, reason: null };

  const lastJob = toDay(a.lastCompletedJobDate);
  const lapsed =
    lastJob.add({ years: PRODUCTION_LAPSE_YEARS }).compare(toDay(a.today)) < 0;
  const approvedBeforeLastJob = toDay(a.latestApprovedAt).compare(lastJob) <= 0;

  return lapsed && approvedBeforeLastJob
    ? { due: true, reason: "Production Lapse" }
    : { due: false, reason: null };
}

export function resolveFirstArticleNeeds(
  input: FirstArticleNeedInput
): FirstArticleNeed[] {
  return input.makeMethods.map((makeMethod) => {
    const required =
      input.companyRequiresFirstArticle ||
      input.customerRequiresFirstArticle ||
      makeMethod.firstArticlePlanId !== null;
    const { due, reason } = evaluateFirstArticleDue({
      latestApprovedAt: makeMethod.latestApprovedAt,
      lastCompletedJobDate: makeMethod.lastCompletedJobDate,
      today: input.today
    });
    const planId =
      makeMethod.firstArticlePlanId ??
      (makeMethod.partPlanIds.length === 1
        ? (makeMethod.partPlanIds[0] ?? null)
        : null);
    const pending = required && due && !makeMethod.hasFirstArticleLot;

    return {
      jobMakeMethodId: makeMethod.jobMakeMethodId,
      itemId: makeMethod.itemId,
      description: makeMethod.description,
      required,
      due,
      reason,
      planId,
      blocked: pending && planId === null,
      create: pending && planId !== null
    };
  });
}
