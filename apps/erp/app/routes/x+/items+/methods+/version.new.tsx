import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  makeMethodVersionValidator,
  upsertMakeMethodVersion,
} from "~/modules/items";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const validation = await validator(makeMethodVersionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertMethodOperation = await upsertMakeMethodVersion(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
  });
  if (insertMethodOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertMethodOperation.error, "Failed to insert new version")
      )
    );
  }

  const methodOperationId = insertMethodOperation.data?.id;
  if (!methodOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertMethodOperation, "Failed to insert new version")
      )
    );
  }

  const redirectFrom = requestReferrer(request);
  const redirectTo = redirectFrom?.replace(
    validation.data.copyFromId,
    methodOperationId
  );

  return redirect(redirectTo ?? path.to.items);
}
