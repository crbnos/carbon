import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  purchaseInvoiceDeliveryValidator,
  upsertPurchaseInvoiceDelivery,
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
  const validation = await validator(purchaseInvoiceDeliveryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Note: Need to add upsertPurchaseInvoiceDelivery to invoicing.service.ts
  const updatePurchaseInvoiceDelivery = await upsertPurchaseInvoiceDelivery(
    client,
    {
      ...validation.data,
      id: invoiceId,
      updatedBy: userId,
      customFields: setCustomFields(formData),
    }
  );
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
