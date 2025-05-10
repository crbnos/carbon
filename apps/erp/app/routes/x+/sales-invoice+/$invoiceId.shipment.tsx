import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  salesInvoiceShipmentValidator,
  upsertSalesInvoiceShipment,
} from "~/modules/invoicing";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const formData = await request.formData();
  const validation = await validator(salesInvoiceShipmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateSalesInvoiceShipment = await upsertSalesInvoiceShipment(client, {
    ...validation.data,
    id: invoiceId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
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
