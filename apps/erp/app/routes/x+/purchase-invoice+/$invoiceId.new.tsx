import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { useUser } from "~/hooks";
import type { PurchaseInvoice } from "~/modules/invoicing";
import {
  getPurchaseInvoice,
  isPurchaseInvoiceLocked,
  PurchaseInvoiceLineForm,
  purchaseInvoiceLineValidator,
  upsertPurchaseInvoiceLine
} from "~/modules/invoicing";
import type { MethodItemType } from "~/modules/shared";
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
      path.to.purchaseInvoiceDetails(invoiceId),
      await flash(
        request,
        error(purchaseInvoice.error, "Failed to load purchase invoice")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseInvoiceLocked(purchaseInvoice.data?.status),
    redirectTo: path.to.purchaseInvoiceDetails(invoiceId),
    message: "Cannot modify a confirmed purchase invoice."
  });

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createPurchaseInvoiceLine = await upsertPurchaseInvoiceLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
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

  throw redirect(path.to.purchaseInvoiceDetails(invoiceId));
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
    invoiceLineType: "Item" as MethodItemType,
    purchaseQuantity: 1,
    locationId:
      purchaseInvoiceData?.purchaseInvoice?.locationId ??
      defaults.locationId ??
      "",
    supplierUnitPrice: 0,
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    taxPercent: 0,
    exchangeRate: purchaseInvoiceData?.purchaseInvoice?.exchangeRate ?? 1
  };

  return <PurchaseInvoiceLineForm initialValues={initialValues} />;
}
