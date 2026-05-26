import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  isSupplierQuoteLocked,
  supplierQuoteLineValidator
} from "~/modules/purchasing";
import {
  getSupplierQuote,
  upsertSupplierQuoteLine
} from "~/modules/purchasing/purchasing.service.server";
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

  await requirePermissions(request, {
    view: "purchasing"
  });
  const quote = await getSupplierQuote(supplierQuoteId);
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

  const createQuotationLine = await upsertSupplierQuoteLine({
    ...d,
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
