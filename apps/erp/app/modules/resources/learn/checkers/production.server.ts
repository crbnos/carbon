/**
 * Carbon Learn — Production challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * "Released" is a set. A job that was released and then worked on reads
 * In Progress, and one that has been finished reads Completed or Closed —
 * asserting `Ready` alone would fail the learner who kept going. `Overdue` and
 * `Due Today` are scheduling read-outs of a released job, not states of their
 * own, so they belong here too.
 */
const RELEASED_JOB_STATUSES = new Set([
  "Ready",
  "In Progress",
  "Paused",
  "Overdue",
  "Due Today",
  "Completed",
  "Closed"
]);

/** Finishing is Completed; closing is what happens after costs settle. */
const FINISHED_JOB_STATUSES = new Set(["Completed", "Closed"]);

/**
 * `production-create-job` — requirements, in curriculum order:
 * `job-exists`, `job-has-operation`, `job-has-material`.
 *
 * A job's method is a snapshot taken at creation, so a job with no operations
 * and no materials is one raised against an item that has no method — which is
 * exactly the mistake this challenge exists to catch.
 */
export async function checkCreateJob({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const jobs = await reader.jobsCreatedBy(scope);

  if (jobs.length === 0) {
    return fail(
      "job-exists",
      "No job created by you since you started this challenge. Raise one and check again."
    );
  }

  const jobIds = jobs.map((job) => job.id);
  const [operations, materials] = await Promise.all([
    reader.jobOperationCount(scope.companyId, jobIds),
    reader.jobMaterialCount(scope.companyId, jobIds)
  ]);

  const withOperation = jobs.filter((job) => (operations[job.id] ?? 0) >= 1);
  if (withOperation.length === 0) {
    const newest = jobs[0];
    return fail(
      "job-has-operation",
      `${newest.jobId || "Your job"} has no operations — raise it against a part whose method has a routing`
    );
  }

  const withMaterial = withOperation.find(
    (job) => (materials[job.id] ?? 0) >= 1
  );
  if (!withMaterial) {
    const newest = withOperation[0];
    return fail(
      "job-has-material",
      `${newest.jobId || "Your job"} has operations but nothing to consume — its method needs a bill of materials`
    );
  }

  return {
    passed: true,
    evidence: {
      jobId: withMaterial.id,
      readableId: withMaterial.jobId,
      operations: operations[withMaterial.id] ?? 0,
      materials: materials[withMaterial.id] ?? 0
    }
  };
}

/**
 * `production-release-job` — requirements, in curriculum order:
 * `job-exists`, `job-released`.
 */
export async function checkReleaseJob({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const jobs = await reader.jobsCreatedBy(scope);

  if (jobs.length === 0) {
    return fail(
      "job-exists",
      "No job created by you since you started this challenge. Raise one first."
    );
  }

  const released = jobs.find((job) => RELEASED_JOB_STATUSES.has(job.status));
  if (!released) {
    const newest = jobs[0];
    return fail(
      "job-released",
      `${newest.jobId || "Your job"} is still ${newest.status || "Draft"} — release it so an operator can start the first operation`
    );
  }

  return {
    passed: true,
    evidence: {
      jobId: released.id,
      readableId: released.jobId,
      status: released.status
    }
  };
}

/**
 * `production-complete-job` (capstone) — requirements, in curriculum order:
 * `job-exists`, `job-produced`, `job-completed`.
 *
 * Quantity is checked BEFORE status on purpose: a job marked Completed with
 * nothing produced is the failure mode worth naming, and naming it as "you have
 * not finished it" would send the learner to the wrong place.
 */
export async function checkCompleteJob({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const jobs = await reader.jobsCreatedBy(scope);

  if (jobs.length === 0) {
    return fail(
      "job-exists",
      "No job created by you since you started this challenge."
    );
  }

  const produced = jobs.filter((job) => job.quantityComplete > 0);
  if (produced.length === 0) {
    const newest = jobs[0];
    return fail(
      "job-produced",
      `${newest.jobId || "Your job"} has produced nothing yet — report a completed quantity from the floor`
    );
  }

  const finished = produced.find((job) =>
    FINISHED_JOB_STATUSES.has(job.status)
  );
  if (!finished) {
    const newest = produced[0];
    return fail(
      "job-completed",
      `${newest.jobId || "Your job"} has produced ${newest.quantityComplete} but is still ${newest.status || "open"} — complete it`
    );
  }

  return {
    passed: true,
    evidence: {
      jobId: finished.id,
      readableId: finished.jobId,
      quantityComplete: finished.quantityComplete,
      status: finished.status
    }
  };
}
