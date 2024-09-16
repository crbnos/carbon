import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import {
  jobOperationValidator,
  upsertJobOperation,
} from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
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

  const updateJobOperation = await upsertJobOperation(client, {
    jobId,
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateJobOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateJobOperation.error, "Failed to update job operation")
      )
    );
  }

  const jobOperationId = updateJobOperation.data?.id;
  if (!jobOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateJobOperation, "Failed to update job operation")
      )
    );
  }

  return json({ id: jobOperationId });
}
