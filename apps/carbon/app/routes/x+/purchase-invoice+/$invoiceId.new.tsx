import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUser } from "~/hooks";
import type { PurchaseInvoice } from "~/modules/invoicing";
import {
  PurchaseInvoiceLineForm,
  purchaseInvoiceLineValidator,
  upsertPurchaseInvoiceLine,
} from "~/modules/invoicing";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createPurchaseInvoiceLine = await upsertPurchaseInvoiceLine(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createPurchaseInvoiceLine.error) {
    throw redirect(
      path.to.purchaseInvoiceDetails(invoiceId),
      await flash(
        request,
        error(
          createPurchaseInvoiceLine.error,
          "Failed to create purchase invoice line."
        )
      )
    );
  }

  throw redirect(
    path.to.purchaseInvoiceLine(invoiceId, createPurchaseInvoiceLine.data.id)
  );
}

export default function NewPurchaseInvoiceLineRoute() {
  const { defaults } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find purchase invoice id");
  const purchaseInvoiceData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
  }>(path.to.purchaseInvoice(invoiceId));

  if (!invoiceId) throw new Error("Could not find purchase invoice id");

  const initialValues = {
    invoiceId: invoiceId,
    invoiceLineType: "Part" as const,
    purchaseQuantity: 1,
    locationId:
      purchaseInvoiceData?.purchaseInvoice?.locationId ??
      defaults.locationId ??
      "",
    supplierUnitPrice: 0,
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    exchangeRate: purchaseInvoiceData?.purchaseInvoice?.exchangeRate ?? 1,
  };

  return <PurchaseInvoiceLineForm initialValues={initialValues} />;
}
