import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { quoteOperationValidator } from "~/modules/sales";
import { saveQuoteOperationWithPrices } from "~/modules/sales/sales.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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
  const validation = await validator(quoteOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // The recalculation below uses the service role: the operation and its line
  // must belong to this company.
  const serviceRole = getCarbonServiceRole();
  await Promise.all([
    requireCompanyRecord(serviceRole, "quoteLine", companyId, {
      id: lineId,
      quoteId
    }),
    requireCompanyRecord(serviceRole, "quoteOperation", companyId, {
      id,
      quoteLineId: lineId
    })
  ]);

  // The update and the line reprice are one command — the same one
  // `sales_upsertQuoteOperation` runs over MCP.
  const saved = await saveQuoteOperationWithPrices(client, {
    quoteId,
    quoteLineId: lineId,
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (saved.error && saved.failedStep !== "recalculate") {
    return data(
      {
        id: null
      },
      await flash(request, error(saved.cause, saved.error.message))
    );
  }

  const quoteOperationId = saved.data!.id;

  return {
    id: quoteOperationId,
    success: true,
    message: "Operation updated"
  };
}
