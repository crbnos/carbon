import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { PurchaseInvoice } from "~/modules/invoicing";
import {
  PurchaseInvoiceForm,
  purchaseInvoiceValidator,
  upsertPurchaseInvoice,
} from "~/modules/invoicing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
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

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceValidator).validate(
    formData
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
    customFields: setCustomFields(formData),
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

export default function PurchaseInvoiceBasicRoute() {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const invoiceData = useRouteData<{ purchaseInvoice: PurchaseInvoice }>(
    path.to.purchaseInvoice(invoiceId)
  );

  if (!invoiceData?.purchaseInvoice)
    throw new Error("purchaseInvoice not found");
  const { purchaseInvoice } = invoiceData;

  if (!invoiceData) throw new Error("Could not find invoice data");

  const initialValues = {
    id: purchaseInvoice.id ?? "",
    invoiceId: purchaseInvoice.invoiceId ?? "",
    supplierId: purchaseInvoice.supplierId ?? "",
    supplierReference: purchaseInvoice.supplierReference ?? "",
    invoiceSupplierId: purchaseInvoice.invoiceSupplierId ?? "",
    paymentTermId: purchaseInvoice.paymentTermId ?? "",
    currencyCode: purchaseInvoice.currencyCode ?? "",
    dateIssued: purchaseInvoice.dateIssued ?? "",
    dateDue: purchaseInvoice.dateDue ?? "",
    status: purchaseInvoice.status ?? ("Draft" as "Draft"),
    ...getCustomFields(purchaseInvoice.customFields),
  };

  return (
    <PurchaseInvoiceForm key={initialValues.id} initialValues={initialValues} />
  );
}
