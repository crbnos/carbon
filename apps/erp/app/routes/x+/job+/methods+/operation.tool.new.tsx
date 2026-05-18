import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertJobOperationTool } from "~/modules/production";
import { operationToolValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const formData = await request.formData();
  const validation = await validator(operationToolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertJobOperationTool({
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
        error(insert.error, "Failed to insert job operation tool")
      )
    );
  }

  const jobOperationToolId = insert.data?.id;
  if (!jobOperationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert job operation tool")
      )
    );
  }

  return { id: jobOperationToolId };
}
