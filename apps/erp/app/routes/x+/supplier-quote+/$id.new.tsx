import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSupplierQuote,
  isSupplierQuoteLocked,
  supplierQuoteLineValidator,
  upsertSupplierQuoteLine
} from "~/modules/purchasing";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { id: supplierQuoteId } = params;
  if (!supplierQuoteId) throw new Error("Could not find supplierQuoteId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  const quote = await getSupplierQuote(viewClient, supplierQuoteId);
  await requireUnlocked({
    request,
    isLocked: isSupplierQuoteLocked(quote.data?.status),
    redirectTo: path.to.supplierQuote(supplierQuoteId),
    message: "Cannot modify a locked supplier quote. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(supplierQuoteLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const serviceRole = getCarbonServiceRole();

  // The line is written through the service role: the quote in the URL and
  // the item on the form must belong to this company, and the line is always
  // attached to the URL's quote rather than the form's copy.
  await Promise.all([
    requireCompanyRecord(serviceRole, "supplierQuote", companyId, {
      id: supplierQuoteId
    }),
    d.itemId
      ? requireCompanyRecord(serviceRole, "item", companyId, { id: d.itemId })
      : null
  ]);

  const createQuotationLine = await upsertSupplierQuoteLine(serviceRole, {
    ...d,
    supplierQuoteId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createQuotationLine.error) {
    throw redirect(
      path.to.supplierQuote(supplierQuoteId),
      await flash(
        request,
        error(createQuotationLine.error, "Failed to create quote line.")
      )
    );
  }

  const quoteLineId = createQuotationLine.data.id;

  throw redirect(path.to.supplierQuoteLine(supplierQuoteId, quoteLineId));
}
