import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { makeMethodVersionValidator } from "~/modules/items";
import { createMakeMethodVersion } from "~/modules/items/items.server";
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

  const created = await createMakeMethodVersion(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (!created.data) {
    return data(
      {
        id: null
      },
      await flash(request, error(created.cause, created.error?.message))
    );
  }
  if (created.error) {
    return {
      success: false,
      message: created.error.message
    };
  }
  const { id: methodOperationId, itemId, type: itemType } = created.data;

  // @ts-expect-error
  throw redirect(getPathToMakeMethod(itemType, itemId, methodOperationId));
}
