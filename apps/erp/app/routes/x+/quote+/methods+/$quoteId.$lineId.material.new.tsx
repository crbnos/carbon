import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { quoteMaterialValidator } from "~/modules/sales";
import {
  recalculateQuoteLinePrices,
  upsertQuoteMaterial,
  upsertQuoteMaterialMakeMethod
} from "~/modules/sales/sales.service.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
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

  const serviceRole = getCarbonServiceRole();
  const insertQuoteMaterial = await upsertQuoteMaterial({
    ...validation.data,
    quoteId,
    quoteLineId: lineId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertQuoteMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertQuoteMaterial.error, "Failed to insert quote material")
      )
    );
  }

  const quoteMaterialId = insertQuoteMaterial.data?.id;
  if (!quoteMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertQuoteMaterial, "Failed to insert quote material")
      )
    );
  }

  if (validation.data.methodType === "Make to Order") {
    const materialMakeMethod = await serviceRole
      .from("quoteMaterialWithMakeMethodId")
      .select("*")
      .eq("id", quoteMaterialId)
      .single();
    if (materialMakeMethod.error) {
      return data(
        {
          id: null
        },
        await flash(
          request,
          error(materialMakeMethod.error, "Failed to get material make method")
        )
      );
    }
    const makeMethod = await upsertQuoteMaterialMakeMethod({
      sourceId: validation.data.itemId,
      targetId: materialMakeMethod.data?.quoteMaterialMakeMethodId!
    });

    if (makeMethod.error) {
      return data(
        {
          id: quoteMaterialId
        },
        await flash(
          request,
          error(makeMethod.error, "Failed to insert quote material make method")
        )
      );
    }
  }

  await recalculateQuoteLinePrices(quoteId, lineId);

  return {
    id: quoteMaterialId,
    success: true,
    message: "Material created"
  };
}
