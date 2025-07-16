import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams } from "~/hooks";
import type { PurchaseOrderStatus } from "~/modules/purchasing";
import {
  purchaseOrderValidator,
  upsertPurchaseOrder,
} from "~/modules/purchasing";
import { PurchaseOrderForm } from "~/modules/purchasing/ui/PurchaseOrder";

import { getNextSequence } from "~/modules/settings";
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
    bypassRls: true,
  });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let purchaseOrderId = validation.data.purchaseOrderId;
  const useNextSequence = !purchaseOrderId;

  if (useNextSequence) {
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
    purchaseOrderId = nextSequence.data;
  }

  if (!purchaseOrderId) throw new Error("purchaseOrderId is not defined");

  const createPurchaseOrder = await upsertPurchaseOrder(client, {
    ...validation.data,
    purchaseOrderId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createPurchaseOrder.error || !createPurchaseOrder.data?.[0]) {
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
    purchaseOrderType: "Purchase" as const,
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <PurchaseOrderForm initialValues={initialValues} />
    </div>
  );
}
