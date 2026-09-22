import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { completeJobOperationBatchValidator } from "~/services/models";
import {
  getJobOperationBatch,
  type JobOperationBatch
} from "~/services/operations.service";

// A batch planned with a combined output merges every member's produced lot
// into the planned lot number once completion lands. Parent ids are derived
// SERVER-SIDE from membership: this route invokes `issue` with the SERVICE
// ROLE, so the edge fn's `inventory` check validates the service role rather
// than the operator. A second call finds nothing (parents are Consumed), so a
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
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });
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
  // edge fn refuses an output with no number at all).
  const plannedLotNumber = planned.data.mergeOutput
    ? planned.data.outputLotNumber
    : null;

  // The edge function owns the whole completion: slice events + record quantities
  // (phase 1, one txn), then issue each member's BOM + flip members Done + post GL
  // (phase 2, idempotent). A phase-2 failure leaves the batch 'Completing'; the
  // operator re-submitting this form re-invokes and resumes without double effects.
  const completeResult = await serviceRole.functions.invoke<{
    memberIds?: string[];
    error?: string;
  }>("batch-operations", {
    body: {
      type: "complete",
      batchId,
      // An excluded ("not in this run") member detaches back to the schedule;
      // its quantities are forced to 0 so a dimmed-but-stale input can never
      // record output for an operation that was not run.
      members: validation.data.members.map((m) => {
        const excluded = m.excluded === "true";
        return {
          jobOperationId: m.jobOperationId,
          quantity: excluded ? 0 : (m.quantity ?? 0),
          scrapQuantity: excluded ? 0 : (m.scrapQuantity ?? 0),
          trackedEntityId: m.trackedEntityId || null,
          batchNumber: plannedLotNumber,
          excluded
        };
      }),
      companyId,
      userId
    }
  });

  // "Already completed" is not a failure: a duplicate submit (double click,
  // a retry after a slow first attempt) means the work landed. Fall through to
  // the merge step, which is itself idempotent — the parents are Consumed by
  // then, so it finds no groups — and report success. Reporting this as
  // an error told the operator the completion failed when it had just
  // succeeded, with the lots and the merged lot already written.
  const completionErrorMessage =
    completeResult.data?.error ??
    (completeResult.error ? String(completeResult.error.message ?? "") : "");
  const alreadyCompleted = /already been completed|already completed/i.test(
    completionErrorMessage
  );
  if (
    (completeResult.error || completeResult.data?.error) &&
    !alreadyCompleted
  ) {
    return data(
      {},
      await flash(
        request,
        error(
          completeResult.error ?? completeResult.data?.error,
          "Failed to complete batch"
        )
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
    const mergeResult = await serviceRole.functions.invoke<{ error?: string }>(
      "issue",
      {
        body: {
          type: "mergeTrackedEntities",
          trackedEntityIds: mergeLots,
          readableId: plannedLotNumber,
          companyId,
          userId
        }
      }
    );
    if (mergeResult.error || mergeResult.data?.error) {
      return data(
        { completed: true },
        await flash(
          request,
          error(
            mergeResult.error ?? mergeResult.data?.error,
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
