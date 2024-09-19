import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import type { PurchaseOrderLineType } from "~/modules/purchasing";
import {
  PurchaseOrderLineForm,
  purchaseOrderLineValidator,
  upsertPurchaseOrderLine,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createPurchaseOrderLine = await upsertPurchaseOrderLine(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createPurchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderLines(orderId),
      await flash(
        request,
        error(
          createPurchaseOrderLine.error,
          "Failed to create purchase order line."
        )
      )
    );
  }

  throw redirect(path.to.purchaseOrderLines(orderId));
}

export default function NewPurchaseOrderLineRoute() {
  const { orderId } = useParams();

  if (!orderId) throw new Error("Could not find purchase order id");

  const initialValues = {
    purchaseOrderId: orderId,
    purchaseOrderLineType: "Part" as PurchaseOrderLineType,
    itemId: "",
    purchaseQuantity: 1,
    unitPrice: 0,
    setupPrice: 0,
    purchaseUnitOfMeasureCode: "",
    inventoryUnitOfMeasureCode: "",
    conversionFactor: 1,
    shelfId: "",
  };

  return <PurchaseOrderLineForm initialValues={initialValues} />;
}
