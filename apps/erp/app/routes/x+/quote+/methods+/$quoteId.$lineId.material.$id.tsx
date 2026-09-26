import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  quoteMaterialValidator,
  recalculateQuoteLinePrices,
  upsertQuoteMaterial
} from "~/modules/sales";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
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

  // The update below uses the service role, which bypasses RLS: the material,
  // its line and every parent id in the form must belong to this company.
  const serviceRole = getCarbonServiceRole();
  await Promise.all([
    requireCompanyRecord(serviceRole, "quoteLine", companyId, {
      id: lineId,
      quoteId
    }),
    requireCompanyRecord(serviceRole, "quoteMaterial", companyId, {
      id,
      quoteLineId: lineId
    }),
    validation.data.quoteOperationId
      ? requireCompanyRecord(serviceRole, "quoteOperation", companyId, {
          id: validation.data.quoteOperationId,
          quoteLineId: lineId
        })
      : undefined
  ]);

  const updateQuoteMaterial = await upsertQuoteMaterial(serviceRole, {
    quoteId,
    quoteLineId: lineId,
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateQuoteMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateQuoteMaterial.error, "Failed to update quote material")
      )
    );
  }

  const quoteMaterialId = updateQuoteMaterial.data?.id;
  if (!quoteMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateQuoteMaterial, "Failed to update quote material")
      )
    );
  }

  await recalculateQuoteLinePrices(
    serviceRole,
    companyId,
    quoteId,
    lineId,
    userId
  );

  return {
    id: quoteMaterialId,
    methodType: updateQuoteMaterial.data.methodType,
    success: true,
    message: "Material updated"
  };
}
