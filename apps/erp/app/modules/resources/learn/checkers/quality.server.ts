/**
 * Carbon Learn — Quality challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/** An inspection with no verdict is a record nobody can act on. */
const RESULTED_INSPECTION_STATUSES = new Set(["Pass", "Fail"]);

/**
 * `quality-raise-issue` — requirements, in curriculum order:
 * `issue-exists`, `issue-described`.
 */
export async function checkRaiseIssue({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const issues = await reader.nonConformancesCreatedBy(scope);

  if (issues.length === 0) {
    return fail(
      "issue-exists",
      "No non-conformance raised by you since you started this challenge. Raise one and check again."
    );
  }

  const described = issues.find((issue) => issue.name.trim().length > 0);
  if (!described) {
    return fail(
      "issue-described",
      `${issues[0].nonConformanceId || "Your non-conformance"} has no name — say what is actually wrong, so the next person can act on it`
    );
  }

  return {
    passed: true,
    evidence: {
      nonConformanceId: described.id,
      readableId: described.nonConformanceId,
      name: described.name
    }
  };
}

/**
 * `quality-record-inspection` — requirements, in curriculum order:
 * `inspection-exists`, `inspection-resulted`.
 */
export async function checkRecordInspection({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const inspections = await reader.inspectionsCreatedBy(scope);

  if (inspections.length === 0) {
    return fail(
      "inspection-exists",
      "No inspection created by you since you started this challenge. Record one and check again."
    );
  }

  const resulted = inspections.find(
    (inspection) =>
      inspection.status !== null &&
      RESULTED_INSPECTION_STATUSES.has(inspection.status)
  );
  if (!resulted) {
    const newest = inspections[0];
    return fail(
      "inspection-resulted",
      `${newest.inspectionId || "Your inspection"} has no result yet — record a Pass or a Fail`
    );
  }

  return {
    passed: true,
    evidence: {
      inspectionId: resulted.id,
      readableId: resulted.inspectionId,
      status: resulted.status
    }
  };
}

/**
 * `quality-close-an-issue` (capstone) — requirements, in curriculum order:
 * `issue-exists`, `issue-closed`, `issue-close-dated`.
 *
 * The close date is checked separately from the status because they are set by
 * different things: the status is the workflow, the date is what an auditor
 * reads. A Closed non-conformance with no close date is the state worth naming.
 */
export async function checkCloseAnIssue({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const issues = await reader.nonConformancesCreatedBy(scope);

  if (issues.length === 0) {
    return fail(
      "issue-exists",
      "No non-conformance raised by you since you started this challenge."
    );
  }

  const closed = issues.filter((issue) => issue.status === "Closed");
  if (closed.length === 0) {
    const newest = issues[0];
    return fail(
      "issue-closed",
      `${newest.nonConformanceId || "Your non-conformance"} is still ${newest.status || "open"} — work it through to Closed`
    );
  }

  const dated = closed.find((issue) => Boolean(issue.closeDate));
  if (!dated) {
    return fail(
      "issue-close-dated",
      `${closed[0].nonConformanceId || "Your non-conformance"} is Closed but carries no close date — an auditor reads the date, not the status`
    );
  }

  return {
    passed: true,
    evidence: {
      nonConformanceId: dated.id,
      readableId: dated.nonConformanceId,
      closeDate: dated.closeDate
    }
  };
}
