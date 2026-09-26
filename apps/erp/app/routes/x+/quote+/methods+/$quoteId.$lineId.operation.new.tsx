import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  quoteOperationValidator,
  recalculateQuoteLinePrices,
  upsertQuoteOperation
} from "~/modules/sales";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  // RLS only checks the new row's companyId, and the recalculation below uses
  // the service role: the line and make method must belong to this company.
  const serviceRole = getCarbonServiceRole();
  await Promise.all([
    requireCompanyRecord(serviceRole, "quoteLine", companyId, {
      id: lineId,
      quoteId
    }),
    requireCompanyRecord(serviceRole, "quoteMakeMethod", companyId, {
      id: validation.data.quoteMakeMethodId,
      quoteLineId: lineId
    })
  ]);

  const insertQuoteOperation = await upsertQuoteOperation(client, {
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

  await recalculateQuoteLinePrices(
    serviceRole,
    companyId,
    quoteId,
    lineId,
    userId
  );

  return {
    id: quoteOperationId,
    success: true,
    message: "Operation created"
  };
}
