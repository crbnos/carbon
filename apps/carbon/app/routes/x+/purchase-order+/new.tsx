import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams } from "~/hooks";
import type {
  PurchaseOrderStatus,
  PurchaseOrderType,
} from "~/modules/purchasing";
import {
  PurchaseOrderForm,
  purchaseOrderValidator,
  upsertPurchaseOrder,
} from "~/modules/purchasing";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.purchaseOrders,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const nextSequence = await getNextSequence(
    client,
    "purchaseOrder",
    companyId
  );
  if (nextSequence.error) {
    throw redirect(
      path.to.newPurchaseOrder,
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const createPurchaseOrder = await upsertPurchaseOrder(client, {
    ...validation.data,
    purchaseOrderId: nextSequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createPurchaseOrder.error || !createPurchaseOrder.data?.[0]) {
    // TODO: this should be done as a transaction
    await rollbackNextSequence(client, "purchaseOrder", companyId);
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(createPurchaseOrder.error, "Failed to insert purchase order")
      )
    );
  }

  const order = createPurchaseOrder.data?.[0];

  throw redirect(path.to.purchaseOrder(order.id!));
}

export default function PurchaseOrderNewRoute() {
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");
  const initialValues = {
    id: undefined,
    purchaseOrderId: undefined,
    supplierId: supplierId ?? "",
    orderDate: today(getLocalTimeZone()).toString(),
    status: "Draft" as PurchaseOrderStatus,
    type: "Purchase" as PurchaseOrderType,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <PurchaseOrderForm initialValues={initialValues} />
    </div>
  );
}
