import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { z } from "zod";
import { useUrlParams, useUser } from "~/hooks";
import type { PurchaseOrderStatus } from "~/modules/purchasing";
import {
  insertPurchaseOrder,
  purchaseOrderValidator
} from "~/modules/purchasing";
import { PurchaseOrderForm } from "~/modules/purchasing/ui/PurchaseOrder";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const newPurchaseOrderValidator = purchaseOrderValidator.extend({
  locationId: z.string().min(1, { message: "Location is required" })
});

export const handle: Handle = {
  breadcrumb: msg`Orders`,
  to: path.to.purchaseOrders
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing",
      bypassRls: true
    });

  const formData = await request.formData();
  const validation = await validator(newPurchaseOrderValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await insertPurchaseOrder(client, {
    ...validation.data,
    purchaseOrderId: validation.data.purchaseOrderId || undefined,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(result.error, "Failed to insert purchase order")
      )
    );
  }

  throw redirect(path.to.purchaseOrder(result.data.id));
}

export default function PurchaseOrderNewRoute() {
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");
  const { defaults } = useUser();
  const initialValues = {
    id: undefined,
    purchaseOrderId: undefined,
    supplierId: supplierId ?? "",
    locationId: defaults?.locationId ?? "",
    orderDate: today(getLocalTimeZone()).toString(),
    status: "Draft" as PurchaseOrderStatus,
    purchaseOrderType: "Purchase" as const
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <PurchaseOrderForm initialValues={initialValues} />
    </div>
  );
}
