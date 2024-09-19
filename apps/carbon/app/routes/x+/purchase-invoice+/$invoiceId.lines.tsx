import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  PurchaseInvoiceLines,
  purchaseInvoiceValidator,
  upsertPurchaseInvoice,
} from "~/modules/invoicing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "invoicing",
  });

  const { invoiceId: id } = params;
  if (!id) throw new Error("Could not find invoiceId");

  const validation = await validator(purchaseInvoiceValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { invoiceId, ...data } = validation.data;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const updatePurchaseInvoice = await upsertPurchaseInvoice(client, {
    id,
    invoiceId,
    ...data,
    updatedBy: userId,
  });
  if (updatePurchaseInvoice.error) {
    throw redirect(
      path.to.purchaseInvoice(id),
      await flash(
        request,
        error(updatePurchaseInvoice.error, "Failed to update purchase invoice")
      )
    );
  }

  throw redirect(
    path.to.purchaseInvoice(id),
    await flash(request, success("Updated purchase invoice"))
  );
}

export default function PurchaseInvoiceLinesRoute() {
  return <PurchaseInvoiceLines />;
}
