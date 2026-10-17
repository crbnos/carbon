// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import { redirect, round } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useUser } from "~/hooks";
import { resolvePurchaseLineTax } from "~/modules/accounting/accounting.service";
import type { LineTaxDecision } from "~/modules/accounting/accounting.utils";
import {
  isPurchaseInvoiceLocked,
  purchaseInvoiceLineValidator
} from "~/modules/invoicing/invoicing.models";
import {
  getPurchaseInvoice,
  upsertPurchaseInvoiceLine
} from "~/modules/invoicing/invoicing.service";
import type { PurchaseInvoice } from "~/modules/invoicing/types";
import { PurchaseInvoiceLineForm } from "~/modules/invoicing/ui";
import type { MethodItemType } from "~/modules/shared/types";
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

  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
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

  // A request that names no tax code (the API, MCP) takes the line's
  // resolved tax. The form always sends the field, so its pick stands.
  if (!formData.has("taxCodeId")) {
    const tax = await resolvePurchaseLineTax(client, {
      companyId,
      companyGroupId,
      supplierId: purchaseInvoice.data?.supplierId,
      itemId: d.itemId,
      documentDate: purchaseInvoice.data?.dateIssued,
      currencyCode: purchaseInvoice.data?.currencyCode,
      unitPrice: d.supplierUnitPrice ?? 0,
      quantity: d.quantity ?? 0,
      shippingCost: d.supplierShippingCost ?? 0
    });
    if (tax) Object.assign(d, tax);
  }

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
    resolvedTax: LineTaxDecision | null;
  }>(path.to.purchaseInvoice(invoiceId));

  if (!invoiceId) throw new Error("Could not find purchase invoice id");

  const initialValues = {
    invoiceId: invoiceId,
    // "Item" is the picker's generic mode, not a member of the line-type
    // enum; posting it failed validation with "Type is required".
    invoiceLineType: "Part" as MethodItemType,
    purchaseQuantity: 1,
    locationId:
      purchaseInvoiceData?.purchaseInvoice?.locationId ??
      defaults.locationId ??
      "",
    supplierUnitPrice: 0,
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    // The supplier's tax code, else its bare percent.
    taxCodeId: purchaseInvoiceData?.resolvedTax?.taxCodeId ?? undefined,
    taxPercent: round(purchaseInvoiceData?.resolvedTax?.taxPercent ?? 0),
    exchangeRate: purchaseInvoiceData?.purchaseInvoice?.exchangeRate ?? 1
  };

  return <PurchaseInvoiceLineForm initialValues={initialValues} />;
}
