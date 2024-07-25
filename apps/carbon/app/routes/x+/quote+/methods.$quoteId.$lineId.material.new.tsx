import { validationError, validator } from "@carbon/remix-validated-form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { quoteMaterialValidator, upsertQuoteMaterial } from "~/modules/sales";
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

  const { quoteId, lineId } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const formData = await request.formData();
  const validation = await validator(quoteMaterialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertQuoteMaterial = await upsertQuoteMaterial(client, {
    ...data,
    quoteId,
    quoteLineId: lineId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertQuoteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteMaterial.error, "Failed to insert method material")
      )
    );
  }

  const methodMaterialId = insertQuoteMaterial.data?.id;
  if (!methodMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteMaterial, "Failed to insert method material")
      )
    );
  }

  return json({ id: methodMaterialId });
}
