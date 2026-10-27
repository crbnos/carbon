// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ServerFnError } from "@carbon/api/errors";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { hasBatchScrapApproval } from "@carbon/ee/approvals/scrap.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { erpPosting } from "~/services/erp";
import {
  completeJobOperationBatchValidator,
  scrapApproverValidator
} from "~/services/models";
import {
  abilityBlockRefusal,
  getJobOperationBatch,
  type JobOperationBatch
} from "~/services/operations.service";
import { postScrapWithApproval } from "~/services/scrap-approval.server";

const logger = getLogger("mes", "batch-complete");

// A batch planned with a combined output merges every member's produced lot
// into the planned lot number once completion lands. Parent ids are derived
// SERVER-SIDE from membership: this route runs the `issue` posting with the
// SERVICE ROLE, so its `inventory` check passes for the system rather than
// for the operator. A second call finds nothing (parents are Consumed), so a
// resume never double-merges.
async function getPlannedMergeLots(
  serviceRole: Awaited<ReturnType<typeof getCarbonServiceRole>>,
  batch: JobOperationBatch,
  companyId: string
): Promise<string[] | null> {
  if (!batch.mergeOutput || batch.status !== "Completed") return [];
  const entityIds = (batch.operations ?? [])
    .map((operation) => operation.trackedEntityId)
    .filter(Boolean) as string[];
  if (entityIds.length < 2) return [];
  const outputs = await serviceRole
    .from("trackedEntity")
    .select("id")
    .in("id", entityIds)
    .eq("companyId", companyId)
    .eq("status", "Available")
    .gt("quantity", 0);
  // null = could not tell, which the caller reports instead of skipping.
  if (outputs.error) return null;
  const ids = (outputs.data ?? []).map((lot) => lot.id);
  return ids.length >= 2 ? ids : [];
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId, sessionUserId } = await requirePermissions(
    request,
    {
      update: "production"
    }
  );
  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const formData = await request.formData();

  const validation = await validator(
    completeJobOperationBatchValidator
  ).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();
  const planned = await getJobOperationBatch(serviceRole, batchId, companyId);
  if (planned.error || !planned.data) {
    return data(
      {},
      await flash(request, error(planned.error, "Batch not found"))
    );
  }
  // Lot identity was planned at creation: a merged batch stamps its one lot
  // number on every member's output; otherwise each member keeps its own
  // planned number (null leaves the entity's readableId untouched, and the
  // posting refuses an output with no number at all).
  // The posting runs with the service role, so the submitted
  // member ids must be this batch's members, and any tracked entity this
  // company's — one scoped query for the entity list.
  const memberIds = new Set(
    (planned.data.operations ?? []).map((operation) => operation.id)
  );
  const foreignMember = validation.data.members.find(
    (m) => !memberIds.has(m.jobOperationId)
  );
  const submittedEntityIds = [
    ...new Set(
      validation.data.members
        .map((m) => m.trackedEntityId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const ownedEntities = submittedEntityIds.length
    ? await serviceRole
        .from("trackedEntity")
        .select("id")
        .in("id", submittedEntityIds)
        .eq("companyId", companyId)
    : { data: [], error: null };
  if (
    foreignMember ||
    ownedEntities.error ||
    (ownedEntities.data ?? []).length !== submittedEntityIds.length
  ) {
    logger.warn("Batch completion references records outside the batch", {
      companyId,
      batchId,
      jobOperationId: foreignMember?.jobOperationId,
      trackedEntityIds: submittedEntityIds,
      error: ownedEntities.error
    });
    return data(
      {},
      await flash(request, error(null, "Batch member not found"))
    );
  }

  // Every member runs the batch's one process, so one member's check covers
  // the whole batch.
  const firstMemberId = validation.data.members[0]?.jobOperationId;
  const abilityRefusal = firstMemberId
    ? await abilityBlockRefusal(serviceRole, {
        operationId: firstMemberId,
        employeeId: userId,
        companyId
      })
    : null;
  if (abilityRefusal) {
    return data({}, await flash(request, error(null, abilityRefusal)));
  }

  const plannedLotNumber = planned.data.mergeOutput
    ? planned.data.outputLotNumber
    : null;

  // An excluded ("not in this run") member detaches back to the schedule;
  // its quantities are forced to 0 so a dimmed-but-stale input can never
  // record output for an operation that was not run.
  const members = validation.data.members.map((m) => {
    const excluded = m.excluded === "true";
    return {
      jobOperationId: m.jobOperationId,
      quantity: excluded ? 0 : (m.quantity ?? 0),
      scrapQuantity: excluded ? 0 : (m.scrapQuantity ?? 0),
      trackedEntityId: m.trackedEntityId || null,
      batchNumber: plannedLotNumber,
      excluded
    };
  });

  // The batch-operations operation owns the whole completion: slice events + record quantities
  // (phase 1, one txn), then issue each member's BOM + flip members Done + post GL
  // (phase 2, idempotent). A phase-2 failure leaves the batch 'Completing'; the
  // operator re-submitting this form re-invokes and resumes without double effects.
  const complete = () =>
    erpPosting(
      "batch-operations",
      { companyId, userId },
      { type: "complete", batchId, members }
    );

  // Scrap in the batch meets the scrap approval rules as one scrap: the
  // members' summed value, signed by one approver.
  const scrapped = members.filter((m) => m.scrapQuantity > 0);
  // The posting's own error, or the reason the approval check refused.
  let completeError: ServerFnError | null = null;
  let approvalRefusal: string | null = null;
  if (scrapped.length > 0) {
    const approver = await validator(scrapApproverValidator).validate(formData);
    const outcome = await postScrapWithApproval({
      request,
      companyId,
      userId,
      sessionUserId,
      subject: {
        type: "batch",
        jobOperationBatchId: batchId,
        members: scrapped.map((m) => ({
          jobOperationId: m.jobOperationId,
          scrapQuantity: m.scrapQuantity
        }))
      },
      approver: approver.error ? {} : approver.data,
      post: complete,
      // A completion that failed in phase 2 already recorded its scrap; the
      // resume posts it without asking for a second approval.
      alreadyApproved: () =>
        hasBatchScrapApproval(getDatabaseClient(), {
          companyId,
          jobOperationBatchId: batchId
        }),
      postedDespiteError: async () => {
        const after = await getJobOperationBatch(
          serviceRole,
          batchId,
          companyId
        );
        return (
          after.data?.status === "Completing" ||
          after.data?.status === "Completed"
        );
      }
    });
    if (outcome.status === "approval-required") {
      return { scrapApproval: outcome.prompt };
    }
    if (outcome.status === "refused") {
      if (outcome.error instanceof ServerFnError) completeError = outcome.error;
      else approvalRefusal = outcome.message;
    }
  } else {
    completeError = (await complete()).error;
  }

  if (approvalRefusal) {
    return data({}, await flash(request, error(null, approvalRefusal)));
  }

  // "Already completed" is not a failure: a duplicate submit (double click,
  // a retry after a slow first attempt) means the work landed. Fall through to
  // the merge step, which is itself idempotent — the parents are Consumed by
  // then, so it finds no groups — and report success. Reporting this as
  // an error told the operator the completion failed when it had just
  // succeeded, with the lots and the merged lot already written.
  const alreadyCompleted = completeError?.body.alreadyCompleted === true;
  if (completeError && !alreadyCompleted) {
    return data(
      {},
      await flash(
        request,
        error(completeError.message || null, "Failed to complete batch")
      )
    );
  }

  const completed = await getJobOperationBatch(serviceRole, batchId, companyId);
  const mergeLots =
    completed.data && !completed.error
      ? await getPlannedMergeLots(serviceRole, completed.data, companyId)
      : null;
  // A planned merge whose lots could not be read is reported, never skipped.
  if (mergeLots === null && planned.data.mergeOutput) {
    return data(
      { completed: true },
      await flash(
        request,
        error(
          completed.error,
          `Batch completed, but combining lots into ${plannedLotNumber} failed — use "Merge output lots" on the batch`
        )
      )
    );
  }
  if (mergeLots && mergeLots.length >= 2) {
    const mergeResult = await erpPosting(
      "issue",
      { companyId, userId },
      {
        type: "mergeTrackedEntities",
        trackedEntityIds: mergeLots,
        readableId: plannedLotNumber
      }
    );
    if (mergeResult.error) {
      return data(
        { completed: true },
        await flash(
          request,
          error(
            mergeResult.error,
            `Batch completed, but combining lots into ${plannedLotNumber} failed — use "Merge output lots" on the batch`
          )
        )
      );
    }
  }

  // Not a redirect: the completion's own writes fire the page's realtime
  // revalidation mid-action, and React Router drops a fetcher's redirect when
  // a newer navigation started after the submit. JobOperation navigates on
  // `completed` instead.
  return data(
    { completed: true },
    await flash(
      request,
      success(
        mergeLots && mergeLots.length >= 2
          ? `Batch completed — ${mergeLots.length} lots combined into ${plannedLotNumber}`
          : "Batch completed"
      )
    )
  );
}
