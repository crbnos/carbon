import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { methodMaterialValidator, upsertMethodMaterial } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
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

  const updateMethodMaterial = await upsertMethodMaterial(client, {
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateMethodMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateMethodMaterial.error, "Failed to update method material")
      )
    );
  }

  const methodMaterialId = updateMethodMaterial.data?.id;
  if (!methodMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateMethodMaterial, "Failed to update method material")
      )
    );
  }

  return json({ id: methodMaterialId });
}
