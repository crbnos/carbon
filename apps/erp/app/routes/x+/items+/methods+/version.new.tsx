import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  copyMakeMethod,
  makeMethodVersionValidator,
  upsertMakeMethodVersion
} from "~/modules/items";
import { getPathToMakeMethod } from "~/modules/items/ui/Methods/utils";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(makeMethodVersionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertMethodOperation = await upsertMakeMethodVersion({
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (insertMethodOperation.error) {
    return data(
      {
        id: null
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
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodOperation, "Failed to insert new version")
      )
    );
  }

  // @ts-expect-error TS2345 - TODO: fix type
  const copy = await copyMakeMethod({
    sourceId: validation.data.copyFromId,
    targetId: methodOperationId,
    companyId,
    userId
  });

  if (copy.error) {
    return {
      success: false,
      message: "Failed to copy make method"
    };
  }

  // @ts-expect-error
  throw redirect(getPathToMakeMethod(itemType, itemId, methodOperationId));
}
