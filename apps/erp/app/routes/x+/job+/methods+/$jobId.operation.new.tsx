import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  jobOperationValidator,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  upsertJobOperation
} from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const serviceRole = getCarbonServiceRole();
  const { jobId } = params;
  if (!jobId) {
    throw new Error("jobId not found");
  }

  const formData = await request.formData();
  const validation = await validator(jobOperationValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const operationData = validation.data;

  const insertJobOperation = await upsertJobOperation(serviceRole, {
    ...operationData,
    jobId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertJobOperation.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertJobOperation.error, "Failed to insert job operation")
      )
    );
  }

  const jobOperationId = insertJobOperation.data?.id;
  if (!jobOperationId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertJobOperation, "Failed to insert job operation")
      )
    );
  }

  const [recalculateResult, recalculateDependencies] = await Promise.all([
    recalculateJobMakeMethodRequirements(serviceRole, {
      id: validation.data.jobMakeMethodId,
      companyId,
      userId
    }),
    recalculateJobOperationDependencies(serviceRole, getDatabaseClient(), {
      jobId,
      companyId,
      userId
    })
  ]);

  if (recalculateResult.error) {
    return data(
      { id: jobOperationId },
      await flash(
        request,
        error(
          recalculateResult.error,
          "Failed to recalculate job make method requirements"
        )
      )
    );
  }

  if (recalculateDependencies?.error) {
    return data(
      { id: jobOperationId },
      await flash(
        request,
        error(
          recalculateDependencies.error,
          "Failed to recalculate job operation dependencies"
        )
      )
    );
  }

  return {
    id: jobOperationId,
    success: true,
    message: "Operation created"
  };
}
