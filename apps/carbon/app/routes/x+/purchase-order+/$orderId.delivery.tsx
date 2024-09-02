import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  PurchaseOrderDeliveryForm,
  getPurchaseOrderDelivery,
  purchaseOrderDeliveryValidator,
  upsertPurchaseOrderDelivery,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [purchaseOrderDelivery] = await Promise.all([
    getPurchaseOrderDelivery(client, orderId),
    // getShippingTermsList(client, companyId),
  ]);

  if (purchaseOrderDelivery.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(
          purchaseOrderDelivery.error,
          "Failed to load purchase order delivery"
        )
      )
    );
  }

  // if (shippingTerms.error) {
  //   throw redirect(
  //     path.to.purchaseOrders,
  //     await flash(
  //       request,
  //       error(shippingTerms.error, "Failed to load shipping terms")
  //     )
  //   );
  // }

  return json({
    purchaseOrderDelivery: purchaseOrderDelivery.data,
    // shippingTerms: shippingTerms.data ?? [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(purchaseOrderDeliveryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePurchaseOrderDelivery = await upsertPurchaseOrderDelivery(
    client,
    {
      ...validation.data,
      id: orderId,
      updatedBy: userId,
      customFields: setCustomFields(formData),
    }
  );
  if (updatePurchaseOrderDelivery.error) {
    throw redirect(
      path.to.purchaseOrderDelivery(orderId),
      await flash(
        request,
        error(
          updatePurchaseOrderDelivery.error,
          "Failed to update purchase order delivery"
        )
      )
    );
  }

  throw redirect(
    path.to.purchaseOrderDelivery(orderId),
    await flash(request, success("Updated purchase order delivery"))
  );
}

export default function PurchaseOrderDeliveryRoute() {
  const { purchaseOrderDelivery } = useLoaderData<typeof loader>();

  const initialValues = {
    id: purchaseOrderDelivery.id,
    locationId: purchaseOrderDelivery.locationId ?? "",
    shippingMethodId: purchaseOrderDelivery.shippingMethodId ?? "",
    shippingTermId: purchaseOrderDelivery.shippingTermId ?? "",
    trackingNumber: purchaseOrderDelivery.trackingNumber ?? "",
    receiptRequestedDate: purchaseOrderDelivery.receiptRequestedDate ?? "",
    receiptPromisedDate: purchaseOrderDelivery.receiptPromisedDate ?? "",
    deliveryDate: purchaseOrderDelivery.deliveryDate ?? "",
    notes: purchaseOrderDelivery.notes ?? "",
    dropShipment: purchaseOrderDelivery.dropShipment ?? false,
    customerId: purchaseOrderDelivery.customerId ?? "",
    customerLocationId: purchaseOrderDelivery.customerLocationId ?? "",
    ...getCustomFields(purchaseOrderDelivery.customFields),
  };

  return (
    <PurchaseOrderDeliveryForm
      key={initialValues.id}
      initialValues={initialValues}
      // shippingTerms={shippingTerms as ListItem[]}
    />
  );
}
