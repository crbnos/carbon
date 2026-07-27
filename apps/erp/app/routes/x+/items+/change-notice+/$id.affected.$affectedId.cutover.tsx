import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderAffectedItemCutoverValidator,
  updateChangeOrderAffectedItemCutover
} from "~/modules/items";
import { requireEditableChangeOrderRoute } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const locked = await requireEditableChangeOrderRoute(request, {
    client,
    changeOrderId: params.id,
    companyId,
    scope: "engineering"
  });
  if (locked) return locked;

  const formData = await request.formData();
  const validation = await validator(
    changeOrderAffectedItemCutoverValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id,
    supersessionMode,
    discontinuationDate,
    successorEffectivityDate
  } = validation.data;

  const update = await updateChangeOrderAffectedItemCutover(client, {
    id,
    supersessionMode,
    discontinuationDate,
    successorEffectivityDate,
    userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update cutover"))
    );
  }

  return { success: true, id: update.data?.id };
}
