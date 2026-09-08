import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import {
  createJobOperationBatch,
  createJobOperationBatchValidator,
  notifyScheduleInputsChanged,
  recalculateJobRequirements,
  releaseJobOperationBatch,
  unreleaseJobOperationBatch,
  updateJobOperationBatch,
  updateJobOperationBatchValidator
} from "~/modules/production";
import { getEdgeFunctionErrorMessage } from "~/utils/error";

// Releasing a batch can pull a Draft/Planned job's operation onto the floor, so
// refresh those jobs' requirements first — the same safety recalc job release
// performs (no MRP; procurement stays a job-level decision). Returns an error
// message, or null when every recalc succeeded.
async function recalculateUnreleasedMemberJobs(
  client: SupabaseClient<Database>,
  jobIds: string[],
  companyId: string,
  userId: string
): Promise<string | null> {
  const uniqueJobIds = [...new Set(jobIds)];
  if (uniqueJobIds.length === 0) return null;

  const jobs = await client
    .from("job")
    .select("id, status")
    .in("id", uniqueJobIds)
    .eq("companyId", companyId);
  if (jobs.error) {
    return "Failed to load the batch's jobs";
  }

  const serviceRole = getCarbonServiceRole();
  for (const job of jobs.data ?? []) {
    if (job.status === "Draft" || job.status === "Planned") {
      const recalc = await recalculateJobRequirements(serviceRole, {
        id: job.id,
        companyId,
        userId
      });
      if (recalc.error) {
        return `Failed to recalculate requirements for job ${job.id}`;
      }
    }
  }
  return null;
}

// Fetcher-driven board action (mirrors operations.update.tsx): return
// { success, message } so BatchingBoard can toast the specific failure reason.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

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
      const recalcError = await recalculateUnreleasedMemberJobs(
        client,
        (ops.data ?? []).map((op) => op.jobId),
        companyId,
        userId
      );
      if (recalcError) {
        return { success: false, message: recalcError };
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
      // Requirements refresh BEFORE the flip (mirrors job release's ordering);
      // a failure stops the release rather than dispatching stale BOMs.
      const recalcError = await recalculateUnreleasedMemberJobs(
        client,
        (members.data ?? []).map((op) => op.jobId),
        companyId,
        userId
      );
      if (recalcError) {
        return { success: false, message: recalcError };
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
