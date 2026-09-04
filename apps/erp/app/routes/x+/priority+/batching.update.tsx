import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  createJobOperationBatch,
  createJobOperationBatchValidator,
  updateJobOperationBatch,
  updateJobOperationBatchValidator
} from "~/modules/production";
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

  if (intent === "create") {
    const validation = await validator(
      createJobOperationBatchValidator
    ).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
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
