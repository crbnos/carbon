import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type { PurchaseInvoiceLineType } from "~/modules/invoicing";
import {
  PurchaseInvoiceLineForm,
  getPurchaseInvoiceLine,
  purchaseInvoiceLineValidator,
  upsertPurchaseInvoiceLine,
} from "~/modules/invoicing";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const purchaseInvoiceLine = await getPurchaseInvoiceLine(client, lineId);

  return json({
    purchaseInvoiceLine: purchaseInvoiceLine?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "invoicing",
  });

  const { invoiceId, lineId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (data.invoiceLineType === "G/L Account") {
    data.assetId = undefined;
    data.itemId = undefined;
  } else if (data.invoiceLineType === "Fixed Asset") {
    data.accountNumber = undefined;
    data.itemId = undefined;
  } else if (data.invoiceLineType === "Comment") {
    data.accountNumber = undefined;
    data.assetId = undefined;
    data.itemId = undefined;
  } else {
    data.accountNumber = undefined;
    data.assetId = undefined;
  }

  const updatePurchaseInvoiceLine = await upsertPurchaseInvoiceLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updatePurchaseInvoiceLine.error) {
    throw redirect(
      path.to.purchaseInvoiceLines(invoiceId),
      await flash(
        request,
        error(
          updatePurchaseInvoiceLine.error,
          "Failed to update purchase invoice line"
        )
      )
    );
  }

  throw redirect(path.to.purchaseInvoiceLines(invoiceId));
}

export default function EditPurchaseInvoiceLineRoute() {
  const { purchaseInvoiceLine } = useLoaderData<typeof loader>();

  const initialValues = {
    id: purchaseInvoiceLine?.id ?? undefined,
    invoiceId: purchaseInvoiceLine?.invoiceId ?? "",
    invoiceLineType:
      purchaseInvoiceLine?.invoiceLineType ??
      ("Part" as PurchaseInvoiceLineType),
    itemId: purchaseInvoiceLine?.itemId ?? "",
    itemReadableId: purchaseInvoiceLine?.itemReadableId ?? "",
    accountNumber: purchaseInvoiceLine?.accountNumber ?? "",
    assetId: purchaseInvoiceLine?.assetId ?? "",
    description: purchaseInvoiceLine?.description ?? "",
    quantity: purchaseInvoiceLine?.quantity ?? 1,
    unitPrice: purchaseInvoiceLine?.unitPrice ?? 0,
    currencyCode: purchaseInvoiceLine?.currencyCode ?? "USD",
    purchaseUnitOfMeasureCode:
      purchaseInvoiceLine?.purchaseUnitOfMeasureCode ?? "",
    inventoryUnitOfMeasureCode:
      purchaseInvoiceLine?.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: purchaseInvoiceLine?.conversionFactor ?? 1,
    shelfId: purchaseInvoiceLine?.shelfId ?? "",
    ...getCustomFields(purchaseInvoiceLine?.customFields),
  };

  return (
    <PurchaseInvoiceLineForm
      key={initialValues.id}
      // @ts-ignore
      initialValues={initialValues}
    />
  );
}
