import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { jobOperationValidator } from "~/modules/production";
import { createJobOperation } from "~/modules/production/production.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
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

  // The insert uses the service role, which bypasses RLS: the job and its make
  // method must belong to this company.
  await Promise.all([
    requireCompanyRecord(serviceRole, "job", companyId, { id: jobId }),
    requireCompanyRecord(serviceRole, "jobMakeMethod", companyId, {
      id: validation.data.jobMakeMethodId,
      jobId
    })
  ]);

  const created = await createJobOperation({
    ...operationData,
    jobId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  const jobOperationId = created.data?.id ?? null;
  if (created.error) {
    return data(
      { id: jobOperationId },
      await flash(request, error(created.cause, created.error.message))
    );
  }

  return {
    id: jobOperationId,
    success: true,
    message: "Operation created"
  };
}
