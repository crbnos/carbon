import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUser } from "~/hooks";
import type { SalesInvoice } from "~/modules/invoicing";
import {
  salesInvoiceLineValidator,
  upsertSalesInvoiceLine,
} from "~/modules/invoicing";
import SalesInvoiceLineForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm";
import type { MethodItemType } from "~/modules/shared";
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
  const validation = await validator(salesInvoiceLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createSalesInvoiceLine = await upsertSalesInvoiceLine(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
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
    taxPercent: 0,
    exchangeRate: salesInvoiceData?.salesInvoice?.exchangeRate ?? 1,
  };

  return <SalesInvoiceLineForm initialValues={initialValues} />;
}
