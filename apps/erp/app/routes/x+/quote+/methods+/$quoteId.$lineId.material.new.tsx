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
  upsertQuoteMaterial,
  upsertQuoteMaterialMakeMethod
} from "~/modules/sales";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
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

  // The writes below use the service role, which bypasses RLS: every id from
  // the URL and the form must belong to this company and this quote line.
  const serviceRole = getCarbonServiceRole();
  await Promise.all([
    requireCompanyRecord(serviceRole, "quoteLine", companyId, {
      id: lineId,
      quoteId
    }),
    requireCompanyRecord(serviceRole, "quoteMakeMethod", companyId, {
      id: validation.data.quoteMakeMethodId,
      quoteLineId: lineId
    }),
    validation.data.quoteOperationId
      ? requireCompanyRecord(serviceRole, "quoteOperation", companyId, {
          id: validation.data.quoteOperationId,
          quoteLineId: lineId
        })
      : undefined
  ]);

  const insertQuoteMaterial = await upsertQuoteMaterial(serviceRole, {
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
      .eq("companyId", companyId)
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
    const makeMethod = await upsertQuoteMaterialMakeMethod(serviceRole, {
      sourceId: validation.data.itemId,
      targetId: materialMakeMethod.data?.quoteMaterialMakeMethodId!,
      companyId,
      userId
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

  await recalculateQuoteLinePrices(
    serviceRole,
    companyId,
    quoteId,
    lineId,
    userId
  );

  return {
    id: quoteMaterialId,
    success: true,
    message: "Material created"
  };
}
