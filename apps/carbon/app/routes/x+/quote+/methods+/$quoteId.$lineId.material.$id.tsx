import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { quoteMaterialValidator, upsertQuoteMaterial } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

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

  const serviceRole = getSupabaseServiceRole();
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
