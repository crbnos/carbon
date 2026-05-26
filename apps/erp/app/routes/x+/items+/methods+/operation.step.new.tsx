import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  upsertMethodOperationStep
} from "~/modules/items/items.service.server";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  await assertMethodOperationIsDraft(validation.data.operationId);

  const insert = await upsertMethodOperationStep({
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
        error(insert.error, "Failed to insert method operation step")
      )
    );
  }

  const methodOperationStepId = insert.data?.id;
  if (!methodOperationStepId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation step")
      )
    );
  }

  return { id: methodOperationStepId };
}
