import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getPurchaseOrderPayment,
  purchaseOrderPaymentValidator,
  upsertPurchaseOrderPayment,
} from "~/modules/purchasing";
import { PurchaseOrderPaymentForm } from "~/modules/purchasing/ui/PurchaseOrder";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [purchaseOrderPayment] = await Promise.all([
    getPurchaseOrderPayment(client, orderId),
  ]);

  if (purchaseOrderPayment.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(
          purchaseOrderPayment.error,
          "Failed to load purchase order payment"
        )
      )
    );
  }

  return json({
    purchaseOrderPayment: purchaseOrderPayment.data,
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
  const validation = await validator(purchaseOrderPaymentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePurchaseOrderPayment = await upsertPurchaseOrderPayment(client, {
    ...validation.data,
    id: orderId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePurchaseOrderPayment.error) {
    throw redirect(
      path.to.purchaseOrderPayment(orderId),
      await flash(
        request,
        error(
          updatePurchaseOrderPayment.error,
          "Failed to update purchase order payment"
        )
      )
    );
  }

  throw redirect(
    path.to.purchaseOrderPayment(orderId),
    await flash(request, success("Updated purchase order payment"))
  );
}

export default function PurchaseOrderPaymentRoute() {
  const { purchaseOrderPayment } = useLoaderData<typeof loader>();

  const initialValues = {
    id: purchaseOrderPayment.id,
    invoiceSupplierId: purchaseOrderPayment.invoiceSupplierId ?? "",
    invoiceSupplierLocationId:
      purchaseOrderPayment.invoiceSupplierLocationId ?? undefined,
    invoiceSupplierContactId:
      purchaseOrderPayment.invoiceSupplierContactId ?? undefined,
    paymentTermId: purchaseOrderPayment.paymentTermId ?? undefined,
    paymentComplete: purchaseOrderPayment.paymentComplete ?? undefined,
    ...getCustomFields(purchaseOrderPayment.customFields),
  };

  return (
    <PurchaseOrderPaymentForm
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
