import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getPurchaseInvoice,
  isPurchaseInvoiceLocked,
  purchaseInvoiceDeliveryValidator,
  upsertPurchaseInvoiceDelivery
} from "~/modules/invoicing";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  // Check if PI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const purchaseInvoice = await getPurchaseInvoice(viewClient, invoiceId);
  if (purchaseInvoice.error) {
    throw redirect(
      path.to.purchaseInvoice(invoiceId),
      await flash(
        request,
        error(purchaseInvoice.error, "Failed to load purchase invoice")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseInvoiceLocked(purchaseInvoice.data?.status),
    redirectTo: path.to.purchaseInvoice(invoiceId),
    message: "Cannot modify a confirmed purchase invoice."
  });

  const { userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceDeliveryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Note: Need to add upsertPurchaseInvoiceDelivery to invoicing.service.ts
  const updatePurchaseInvoiceDelivery = await upsertPurchaseInvoiceDelivery({
    ...validation.data,
    id: invoiceId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updatePurchaseInvoiceDelivery.error) {
    throw redirect(
      path.to.purchaseInvoice(invoiceId),
      await flash(
        request,
        error(
          updatePurchaseInvoiceDelivery.error,
          "Failed to update purchase invoice delivery"
        )
      )
    );
  }

  throw redirect(
    path.to.purchaseInvoice(invoiceId),
    await flash(request, success("Updated purchase invoice delivery"))
  );
}
