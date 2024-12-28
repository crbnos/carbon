import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { quoteMaterialValidator, upsertQuoteMaterial } from "~/modules/sales";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId, lineId, id } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }
  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(quoteMaterialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = getCarbonServiceRole();
  const updateQuoteMaterial = await upsertQuoteMaterial(serviceRole, {
    quoteId,
    quoteLineId: lineId,
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateQuoteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateQuoteMaterial.error, "Failed to update quote material")
      )
    );
  }

  const quoteMaterialId = updateQuoteMaterial.data?.id;
  if (!quoteMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateQuoteMaterial, "Failed to update quote material")
      )
    );
  }

  return json({
    id: quoteMaterialId,
    methodType: updateQuoteMaterial.data.methodType,
  });
}
