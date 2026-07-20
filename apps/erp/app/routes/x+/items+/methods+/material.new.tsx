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

  const insertMethodMaterial = await upsertMethodMaterial(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (insertMethodMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodMaterial.error, "Failed to insert method material")
      )
    );
  }

  const methodMaterialId = insertMethodMaterial.data?.id;
  if (!methodMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodMaterial, "Failed to insert method material")
      )
    );
  }

  const result = {
    id: methodMaterialId,
    success: true,
    message: "Material created"
  };

  if (lock.warn) {
    return data(result, await flash(request, success(lock.message)));
  }

  return result;
}
