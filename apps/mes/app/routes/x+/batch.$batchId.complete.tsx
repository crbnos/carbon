import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { completeJobOperationBatchValidator } from "~/services/models";
import { getJobOperationBatch } from "~/services/operations.service";
import { path } from "~/utils/path";

// The batch's output-lot merge groups, derived SERVER-SIDE from its
// membership and the batch numbers completion just persisted. Ids are never
// taken from the form: this route invokes `issue` with the SERVICE ROLE, so
// the edge fn's own `inventory` permission check validates the service role
// rather than the operator. Members completed under one batch number form one
// group — the number IS the merge intent. A second call finds nothing (the
// parents are Consumed), so a resume never double-merges.
async function getOutputLotMergeGroups(
  serviceRole: Awaited<ReturnType<typeof getCarbonServiceRole>>,
  batchId: string,
  companyId: string
): Promise<Array<{ readableId: string; ids: string[] }>> {
  const batch = await getJobOperationBatch(serviceRole, batchId, companyId);
  if (batch.error || batch.data?.status !== "Completed") return [];

  const entityIds = (batch.data.operations ?? [])
    .map((operation) => operation.trackedEntityId)
    .filter(Boolean) as string[];
  if (entityIds.length < 2) return [];

  const outputs = await serviceRole
    .from("trackedEntity")
    .select("id, itemId, readableId")
    .in("id", entityIds)
    .eq("companyId", companyId)
    .eq("status", "Available")
    .gt("quantity", 0);

  const groups = new Map<string, { readableId: string; ids: string[] }>();
  for (const lot of outputs.data ?? []) {
    const number = (lot.readableId ?? "").trim();
    if (!number) continue;
    // grouped per item as well: one number across items never merges (the
    // completion form refuses it, and a pre-existing collision must not
    // swallow an unrelated item's lot)
    const key = `${lot.itemId}::${number}`;
    const group = groups.get(key) ?? { readableId: number, ids: [] };
    group.ids.push(lot.id);
    groups.set(key, group);
  }
  return [...groups.values()].filter((g) => g.ids.length > 1);
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

  // One batch number across DIFFERENT items can never merge and must not
  // complete into two same-named lots: refuse before anything happens, so the
  // operator edits the numbers. Item identity comes from the server, not the
  // form.
  const producing = validation.data.members.filter(
    (m) => m.excluded !== "true" && (m.quantity ?? 0) > 0 && m.batchNumber
  );
  if (producing.length > 1) {
    const memberOps = await serviceRole
      .from("jobOperation")
      .select("id, jobMakeMethod(itemId)")
      .in(
        "id",
        producing.map((m) => m.jobOperationId)
      )
      .eq("jobOperationBatchId", batchId)
      .eq("companyId", companyId);
    const itemByOp = new Map(
      (memberOps.data ?? []).map((o) => [o.id, o.jobMakeMethod?.itemId ?? null])
    );
    const itemsByNumber = new Map<string, Set<string>>();
    for (const m of producing) {
      const number = (m.batchNumber ?? "").trim();
      const itemId = itemByOp.get(m.jobOperationId);
      if (!number || !itemId) continue;
      const set = itemsByNumber.get(number) ?? new Set<string>();
      set.add(itemId);
      itemsByNumber.set(number, set);
    }
    const conflict = [...itemsByNumber.entries()].find(
      ([, items]) => items.size > 1
    );
    if (conflict) {
      return data(
        {},
        await flash(
          request,
          error(
            null,
            `Batch number ${conflict[0]} is used for different items — edit the numbers and complete again`
          )
        )
      );
    }
  }

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
          batchNumber: m.batchNumber || null,
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
  // then, so it finds no groups — and redirect as a success. Reporting this as
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

  // Members completed under one batch number merge into one lot right now —
  // the number was the merge intent, confirmed in the form. A failure here
  // leaves the batch completed with its per-member lots intact; the batch
  // drawer's "Merge output lots" is the recovery path.
  const mergeGroups = await getOutputLotMergeGroups(
    serviceRole,
    batchId,
    companyId
  );
  for (const group of mergeGroups) {
    const mergeResult = await serviceRole.functions.invoke<{
      error?: string;
    }>("issue", {
      body: {
        type: "mergeTrackedEntities",
        trackedEntityIds: group.ids,
        readableId: group.readableId,
        companyId,
        userId
      }
    });
    if (mergeResult.error || mergeResult.data?.error) {
      return redirect(
        path.to.operations,
        await flash(
          request,
          error(
            mergeResult.error ?? mergeResult.data?.error,
            `Batch completed, but merging lots into ${group.readableId} failed — use "Merge output lots" on the batch`
          )
        )
      );
    }
  }

  return redirect(
    path.to.operations,
    await flash(
      request,
      success(
        mergeGroups.length > 0
          ? `Batch completed — ${mergeGroups
              .map((g) => `${g.ids.length} lots merged into ${g.readableId}`)
              .join(", ")}`
          : "Batch completed"
      )
    )
  );
}
