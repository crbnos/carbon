import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { quoteMaterialValidator } from "~/modules/sales";
import { saveQuoteMaterialWithPrices } from "~/modules/sales/sales.server";
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

  // The insert, the Make to Order method pull and the line reprice are one
  // command — the same one `sales_upsertQuoteMaterial` runs over MCP.
  const saved = await saveQuoteMaterialWithPrices(serviceRole, {
    ...validation.data,
    quoteId,
    quoteLineId: lineId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  // A failed reprice leaves the saved material in place; the route never
  // surfaced it.
  if (saved.error && saved.failedStep !== "recalculate") {
    return data(
      {
        id: saved.data?.id ?? null
      },
      await flash(request, error(saved.cause, saved.error.message))
    );
  }

  const quoteMaterialId = saved.data!.id;

  return {
    id: quoteMaterialId,
    success: true,
    message: "Material created"
  };
}
