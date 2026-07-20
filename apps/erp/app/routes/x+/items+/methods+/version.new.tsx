import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
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
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(makeMethodVersionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // No change-order gate here: the V1 change-order model applies BOM edits by
  // spinning fresh method versions at Done and never stages/reserves a pending
  // revision, so there is nothing for an open CO to lock against.

  const insertMethodOperation = await upsertMakeMethodVersion(client, {
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
  const copy = await copyMakeMethod(getCarbonServiceRole(), {
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
