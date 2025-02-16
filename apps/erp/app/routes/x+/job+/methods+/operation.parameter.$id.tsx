import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertJobOperationParameter } from "~/modules/production";
import { operationParameterValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const { id } = params;
  if (!id) {
    return json({ success: false, message: "Invalid operation parameter id" });
  }

  const formData = await request.formData();
  const validation = await validator(operationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const { id: _id, ...data } = validation.data;

  const update = await upsertJobOperationParameter(client, {
    id,
    ...data,
    companyId,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  });
  if (update.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(update.error, "Failed to update job operation parameter")
      )
    );
  }

  const operationParameterId = update.data?.id;
  if (!operationParameterId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(update.error, "Failed to update job operation parameter")
      )
    );
  }

  return json(
    { id: operationParameterId },
    await flash(request, success("Job operation parameter updated"))
  );
}
