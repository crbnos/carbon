import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
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

  const { jobId } = params;
  if (!jobId) {
    throw new Error("jobId not found");
  }

  const formData = await request.formData();
  const validation = await validator(jobOperationValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertJobOperation = await upsertJobOperation(client, {
    ...data,
    jobId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertJobOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertJobOperation.error, "Failed to insert job operation")
      )
    );
  }

  const jobOperationId = insertJobOperation.data?.id;
  if (!jobOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertJobOperation, "Failed to insert job operation")
      )
    );
  }

  return json({ id: jobOperationId });
}
