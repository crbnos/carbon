import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { useUser } from "~/hooks";
import type { SalesInvoice } from "~/modules/invoicing";
import {
  getSalesInvoice,
  isSalesInvoiceLocked,
  salesInvoiceLineValidator,
  upsertSalesInvoiceLine
} from "~/modules/invoicing";
import SalesInvoiceLineForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm";
import type { MethodItemType } from "~/modules/shared";
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
      path.to.salesInvoiceDetails(invoiceId),
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
    );
  }

  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoiceDetails(invoiceId),
    message: "Cannot modify a locked sales invoice. Reopen it first."
  });

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(salesInvoiceLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  if (d.invoiceLineType === "Fixed Asset") {
    d.accountId = undefined;
    d.itemId = undefined;
  } else {
    d.accountId = undefined;
    d.assetId = undefined;
  }

  const createSalesInvoiceLine = await upsertSalesInvoiceLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createSalesInvoiceLine.error) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(
        request,
        error(
          createSalesInvoiceLine.error,
          "Failed to create sales invoice line."
        )
      )
    );
  }

  throw redirect(path.to.salesInvoiceDetails(invoiceId));
}

export default function NewSalesInvoiceLineRoute() {
  const { defaults } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find sales invoice id");
  const salesInvoiceData = useRouteData<{
    salesInvoice: SalesInvoice;
  }>(path.to.salesInvoice(invoiceId));

  if (!invoiceId) throw new Error("Could not find sales invoice id");

  const initialValues = {
    invoiceId: invoiceId,
    invoiceLineType: "Item" as MethodItemType,
    quantity: 1,
    unitOfMeasureCode: "EA",
    locationId:
      salesInvoiceData?.salesInvoice?.locationId ?? defaults.locationId ?? "",
    unitPrice: 0,
    shippingCost: 0,
    addOnCost: 0,
    nonTaxableAddOnCost: 0,
    taxPercent: 0,
    exchangeRate: salesInvoiceData?.salesInvoice?.exchangeRate ?? 1
  };

  return <SalesInvoiceLineForm initialValues={initialValues} />;
}
