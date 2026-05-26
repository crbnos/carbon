import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { quoteOperationValidator } from "~/modules/sales";
import {
  recalculateQuoteLinePrices,
  upsertQuoteOperation
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
  const validation = await validator(quoteOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertQuoteOperation = await upsertQuoteOperation({
    ...validation.data,
    quoteId,
    quoteLineId: lineId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertQuoteOperation.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertQuoteOperation.error, "Failed to insert quote operation")
      )
    );
  }

  const quoteOperationId = insertQuoteOperation.data?.id;
  if (!quoteOperationId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertQuoteOperation, "Failed to insert quote operation")
      )
    );
  }

  await recalculateQuoteLinePrices(quoteId, lineId);

  return {
    id: quoteOperationId,
    success: true,
    message: "Operation created"
  };
}
