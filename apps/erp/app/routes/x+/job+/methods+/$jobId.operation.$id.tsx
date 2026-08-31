import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  jobOperationValidator,
  upsertJobOperation
} from "~/modules/production";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId, id } = params;
  if (!jobId) {
    throw new Error("jobId not found");
  }
  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(jobOperationValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const operationData = validation.data;

  const updateJobOperation = await upsertJobOperation(client, {
    jobId,
    ...operationData,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateJobOperation.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateJobOperation.error, "Failed to update job operation")
      )
    );
  }

  const jobOperationId = updateJobOperation.data?.id;
  if (!jobOperationId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateJobOperation, "Failed to update job operation")
      )
    );
  }

  return {
    id: jobOperationId,
    success: true,
    message: "Operation updated"
  };
}
