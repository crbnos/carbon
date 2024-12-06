import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { supplierQuoteLineValidator } from "~/modules/purchasing/purchasing.models";
import { upsertSupplierQuoteLine } from "~/modules/purchasing/purchasing.service";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { id: supplierQuoteId } = params;
  if (!supplierQuoteId) throw new Error("Could not find supplierQuoteId");

  const formData = await request.formData();
  const validation = await validator(supplierQuoteLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const serviceRole = getCarbonServiceRole();
  const createQuotationLine = await upsertSupplierQuoteLine(serviceRole, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
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
