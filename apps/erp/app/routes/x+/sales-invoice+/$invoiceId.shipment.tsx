import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSalesInvoice,
  isSalesInvoiceLocked,
  salesInvoiceShipmentValidator,
  upsertSalesInvoiceShipment
} from "~/modules/invoicing";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  // Check if SI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const invoice = await getSalesInvoice(viewClient, invoiceId);
  if (invoice.error) {
    throw redirect(
      path.to.salesInvoice(invoiceId),
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
    );
  }

  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoice(invoiceId),
    message: "Cannot modify a locked sales invoice. Reopen it first."
  });

  const { userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(salesInvoiceShipmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateSalesInvoiceShipment = await upsertSalesInvoiceShipment({
    ...validation.data,
    id: invoiceId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateSalesInvoiceShipment.error) {
    throw redirect(
      path.to.salesInvoice(invoiceId),
      await flash(
        request,
        error(
          updateSalesInvoiceShipment.error,
          "Failed to update sales invoice shipping"
        )
      )
    );
  }

  throw redirect(
    path.to.salesInvoice(invoiceId),
    await flash(request, success("Updated sales invoice shipping"))
  );
}
