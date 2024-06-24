import { validationError, validator } from "@carbon/remix-validated-form";
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

  const { makeMethodId } = params;
  if (!makeMethodId) {
    throw new Error("makeMethodId not found");
  }

  const formData = await request.formData();
  const validation = await validator(methodMaterialValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertMethodMaterial = await upsertMethodMaterial(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertMethodMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertMethodMaterial.error, "Failed to insert method material")
      )
    );
  }

  const methodMaterialId = insertMethodMaterial.data?.id;
  if (!methodMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertMethodMaterial, "Failed to insert method material")
      )
    );
  }

  return json({ id: methodMaterialId });
}
