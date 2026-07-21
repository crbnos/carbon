import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { methodMaterialValidator, upsertMethodMaterial } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(methodMaterialValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "makeMethod",
    id: validation.data.makeMethodId,
    companyId
  });
  if (!lock.ok) {
    return data({ id: null }, await flash(request, error(null, lock.message)));
  }

  const updateMethodMaterial = await upsertMethodMaterial(client, {
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateMethodMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodMaterial.error, "Failed to update method material")
      )
    );
  }

  const methodMaterialId = updateMethodMaterial.data?.id;
  if (!methodMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodMaterial, "Failed to update method material")
      )
    );
  }

  const result = {
    id: methodMaterialId,
    success: true,
    message: "Material updated"
  };

  if (lock.warn) {
    return data(result, await flash(request, success(lock.message)));
  }

  return result;
}
