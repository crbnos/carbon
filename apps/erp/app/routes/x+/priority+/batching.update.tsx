import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { mergeTrackedEntities } from "~/modules/inventory";
import {
  createJobOperationBatch,
  createJobOperationBatchValidator,
  getBatchOutputLots,
  notifyScheduleInputsChanged,
  releaseJobOperationBatch,
  unreleaseJobOperationBatch,
  updateJobOperationBatch,
  updateJobOperationBatchValidator
} from "~/modules/production";
import { releaseBatchMemberJobs } from "~/modules/production/production.server";
import { getDatabaseClient } from "~/services/database.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";

// Fetcher-driven board action (mirrors operations.update.tsx): return
// { success, message } so BatchingBoard can toast the specific failure reason.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reprioritize") {
    // Within-column reorder of a batch card. The card's board position is
    // min(member priority), so moving the batch means writing every member's
    // priority to the batch's new dispatch slot. Like operations.update, this
    // only re-sequences the manual dispatch order — it does NOT reschedule.
    const batchId = String(formData.get("batchId") ?? "");
    const priority = Number(formData.get("priority"));

    if (!batchId || !Number.isFinite(priority)) {
      return { success: false, message: "Invalid batch reprioritize request" };
    }

    const batch = await client
      .from("jobOperationBatch")
      .select("id, companyId, status")
      .eq("id", batchId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (
      batch.error ||
      batch.data === null ||
      batch.data.companyId !== companyId ||
      // Completing/Completed batches are read-only on the board.
      batch.data.status === "Completing" ||
      batch.data.status === "Completed"
    ) {
      return { success: false, message: "Batch unavailable" };
    }

    const { error } = await client
      .from("jobOperation")
      .update({
        priority,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("jobOperationBatchId", batchId)
      .eq("companyId", companyId)
      .not("status", "in", "(Done,Canceled)");

    if (error) {
      return { success: false, message: error.message };
    }

    return { success: true };
  }

  // Merge a Completed batch's same-item output lots into one lot. The batch
  // completion prompt covers the common case in MES; this is the ERP catch-up
  // for batches whose prompt was skipped. Outputs are re-derived server-side —
  // client-supplied entity ids are never trusted.
  if (intent === "mergeOutputs") {
    const batchId = String(formData.get("batchId") ?? "");
    if (!batchId) {
      return { success: false, message: "Invalid merge request" };
    }
    const batch = await client
      .from("jobOperationBatch")
      .select("id, status")
      .eq("id", batchId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (batch.error || batch.data?.status !== "Completed") {
      return {
        success: false,
        message: "Only a completed batch's output lots can be merged"
      };
    }
    // One item's lots per merge: a mixed batch (A, A, B) merges its As.
    const itemId = formData.get("itemId");
    const outputs = await getBatchOutputLots(client, batchId, companyId);
    if (outputs.error) {
      return { success: false, message: "Failed to load the output lots" };
    }
    const lots = (outputs.data ?? []).filter(
      (lot) => typeof itemId === "string" && lot.itemId === itemId
    );
    if (lots.length < 2) {
      return { success: false, message: "No mergeable output lots" };
    }
    const serviceRole = await getCarbonServiceRole();
    const merge = await mergeTrackedEntities(serviceRole, {
      trackedEntityIds: lots.map((lot) => lot.id),
      companyId,
      userId
    });
    if (merge.error || merge.data?.error) {
      return {
        success: false,
        message:
          (merge.data?.error as string | undefined) ?? "Failed to merge lots"
      };
    }
    return {
      success: true,
      message: merge.data?.readableId
        ? `Lots merged into ${merge.data.readableId}`
        : "Lots merged"
    };
  }

  if (intent === "create") {
    const validation = await validator(
      createJobOperationBatchValidator
    ).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    if (validation.data.release) {
      const ops = await client
        .from("jobOperation")
        .select("jobId")
        .in("id", validation.data.jobOperationIds)
        .eq("companyId", companyId);
      if (ops.error) {
        return { success: false, message: "Failed to load the operations" };
      }
      const releasedJobs = await releaseBatchMemberJobs({
        client,
        db: getDatabaseClient(),
        jobIds: (ops.data ?? []).map((op) => op.jobId),
        companyId,
        userId,
        purchaseOrdersBySupplierId: parsePurchaseOrderChoice(formData)
      });
      if (releasedJobs.error) {
        return { success: false, message: releasedJobs.error };
      }
    }

    const result = await createJobOperationBatch(client, {
      ...validation.data,
      companyId,
      userId
    });

    if (result.error) {
      return {
        success: false,
        message: await getEdgeFunctionErrorMessage(
          result.error,
          "Failed to create batch"
        )
      };
    }

    if (validation.data.release) {
      // The flip is persisted (create inserted 'Active') — safe to wake the
      // scheduler; the wave places the batch as one unit.
      await notifyScheduleInputsChanged(
        companyId,
        "work-center",
        "batch released at creation",
        validation.data.workCenterId ?? undefined
      );
    }
    // The edge fn returns { id, readableId }; the batch builder navigates to the
    // created batch on success. Additive — the schedule board ignores them.
    return {
      success: true,
      batchId: (result.data as { id?: string } | null)?.id ?? null,
      readableId:
        (result.data as { readableId?: string } | null)?.readableId ?? null
    };
  }

  const validation = await validator(updateJobOperationBatchValidator).validate(
    formData
  );
  if (validation.error) {
    // The Kanban drag path submits intent="update" via useSubmit and reads the
    // result as { success, message } — a validationError has no success key, so
    // the drag toast would stay silent on a malformed move. Return the shape the
    // board expects instead.
    return {
      success: false,
      message: "That batch update was invalid and could not be applied"
    };
  }

  const { intent: type, ...rest } = validation.data;

  if (type === "release" || type === "unrelease") {
    const batch = await client
      .from("jobOperationBatch")
      .select("workCenterId")
      .eq("id", rest.batchId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (type === "release") {
      const members = await client
        .from("jobOperation")
        .select("jobId")
        .eq("jobOperationBatchId", rest.batchId)
        .eq("companyId", companyId);
      if (members.error) {
        return { success: false, message: "Failed to load the batch members" };
      }
      // Member jobs release BEFORE the batch flips, through the job page's
      // release path; an invalid job refuses the whole batch untouched.
      const releasedJobs = await releaseBatchMemberJobs({
        client,
        db: getDatabaseClient(),
        jobIds: (members.data ?? []).map((op) => op.jobId),
        companyId,
        userId,
        purchaseOrdersBySupplierId: parsePurchaseOrderChoice(formData)
      });
      if (releasedJobs.error) {
        return { success: false, message: releasedJobs.error };
      }

      const released = await releaseJobOperationBatch(client, {
        batchId: rest.batchId,
        companyId,
        userId
      });
      if (released.error) {
        return {
          success: false,
          message: await getEdgeFunctionErrorMessage(
            released.error,
            "Failed to release batch"
          )
        };
      }
    } else {
      const unreleased = await unreleaseJobOperationBatch(client, {
        batchId: rest.batchId,
        companyId,
        userId
      });
      if (unreleased.error) {
        return {
          success: false,
          message: await getEdgeFunctionErrorMessage(
            unreleased.error,
            "Failed to unrelease batch"
          )
        };
      }
    }

    // After the status flip is persisted — the wave must see the new state.
    await notifyScheduleInputsChanged(
      companyId,
      "work-center",
      type === "release" ? "batch released" : "batch unreleased",
      batch.data?.workCenterId ?? undefined
    );
    return { success: true };
  }

  const result = await updateJobOperationBatch(client, {
    type,
    ...rest,
    // "update" clears the work center when no value is submitted
    workCenterId:
      type === "update" ? (rest.workCenterId ?? null) : rest.workCenterId,
    companyId,
    userId
  });

  if (result.error) {
    return {
      success: false,
      message: await getEdgeFunctionErrorMessage(
        result.error,
        `Failed to ${type} batch`
      )
    };
  }
  return { success: true };
}

// The Release dialog's per-supplier PO choice ("new" or a Draft PO id), posted
// as JSON. Absent when nothing needed choosing.
function parsePurchaseOrderChoice(
  formData: FormData
): Record<string, string> | undefined {
  const raw = formData.get("purchaseOrdersBySupplierId");
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
