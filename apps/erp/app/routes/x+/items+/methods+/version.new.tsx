import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  copyMakeMethod,
  makeMethodVersionValidator,
  upsertMakeMethodVersion,
} from "~/modules/items";
import { getPathToMakeMethod } from "~/modules/items/ui/Methods/utils";

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
  const itemId = insertMethodOperation.data?.itemId;
  const itemType = insertMethodOperation.data?.type;
  if (!methodOperationId || !itemType) {
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

  const copy = await copyMakeMethod(getCarbonServiceRole(), {
    sourceId: validation.data.copyFromId,
    targetId: methodOperationId,
    companyId,
    userId,
  });

  if (copy.error) {
    return json({
      success: false,
      message: "Failed to copy make method",
    });
  }

  // @ts-expect-error
  throw redirect(getPathToMakeMethod(itemType, itemId, methodOperationId));
}
