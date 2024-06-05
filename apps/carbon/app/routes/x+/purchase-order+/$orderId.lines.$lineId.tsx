import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import type { PurchaseOrderLineType } from "~/modules/purchasing";
import {
  PurchaseOrderLineForm,
  getPurchaseOrderLine,
  purchaseOrderLineValidator,
  upsertPurchaseOrderLine,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const purchaseOrderLine = await getPurchaseOrderLine(client, lineId);

  return json({
    purchaseOrderLine: purchaseOrderLine?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (data.purchaseOrderLineType === "G/L Account") {
    data.assetId = undefined;
    data.itemId = undefined;
  } else if (data.purchaseOrderLineType === "Fixed Asset") {
    data.accountNumber = undefined;
    data.itemId = undefined;
  } else if (data.purchaseOrderLineType === "Comment") {
    data.accountNumber = undefined;
    data.assetId = undefined;
    data.itemId = undefined;
  } else {
    data.accountNumber = undefined;
    data.assetId = undefined;
  }

  const updatePurchaseOrderLine = await upsertPurchaseOrderLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updatePurchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderLines(orderId),
      await flash(
        request,
        error(
          updatePurchaseOrderLine.error,
          "Failed to update purchase order line"
        )
      )
    );
  }

  throw redirect(path.to.purchaseOrderLines(orderId));
}

export default function EditPurchaseOrderLineRoute() {
  const { purchaseOrderLine } = useLoaderData<typeof loader>();

  const initialValues = {
    id: purchaseOrderLine?.id ?? undefined,
    purchaseOrderId: purchaseOrderLine?.purchaseOrderId ?? "",
    purchaseOrderLineType:
      purchaseOrderLine?.purchaseOrderLineType ??
      ("Part" as PurchaseOrderLineType),
    itemId: purchaseOrderLine?.itemId ?? "",
    itemReadableId: purchaseOrderLine?.itemReadableId ?? "",
    accountNumber: purchaseOrderLine?.accountNumber ?? "",
    assetId: purchaseOrderLine?.assetId ?? "",
    description: purchaseOrderLine?.description ?? "",
    purchaseQuantity: purchaseOrderLine?.purchaseQuantity ?? 1,
    unitPrice: purchaseOrderLine?.unitPrice ?? 0,
    setupPrice: purchaseOrderLine?.setupPrice ?? 0,
    purchaseUnitOfMeasureCode:
      purchaseOrderLine?.purchaseUnitOfMeasureCode ?? "",
    inventoryUnitOfMeasureCode:
      purchaseOrderLine?.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: purchaseOrderLine?.conversionFactor ?? 1,
    shelfId: purchaseOrderLine?.shelfId ?? "",
    ...getCustomFields(purchaseOrderLine?.customFields),
  };

  return (
    <PurchaseOrderLineForm
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
