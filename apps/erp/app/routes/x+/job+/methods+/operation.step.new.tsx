import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertJobOperationStep } from "~/modules/production/production.service.server";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertJobOperationStep({
    ...validation.data,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert job operation attribute")
      )
    );
  }

  const jobOperationStepId = insert.data?.id;
  if (!jobOperationStepId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert job operation attribute")
      )
    );
  }

  return { id: jobOperationStepId };
}
