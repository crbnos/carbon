import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import {
  insertPurchaseReturnOrder,
  purchaseReturnOrderValidator
} from "~/modules/purchasing";
import { PurchaseReturnOrderForm } from "~/modules/purchasing/ui/PurchaseReturnOrders";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Supplier Returns`,
  to: path.to.purchaseReturnOrders
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing",
      bypassRls: true
    });

  const formData = await request.formData();
  const validation = await validator(purchaseReturnOrderValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, status: _status, ...data } = validation.data;

  const result = await insertPurchaseReturnOrder(client, {
    ...data,
    purchaseReturnOrderId: data.purchaseReturnOrderId || undefined,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.purchaseReturnOrders,
      await flash(
        request,
        error(result.error, "Failed to insert purchase return order")
      )
    );
  }

  throw redirect(path.to.purchaseReturnOrderDetails(result.data.id));
}

export default function PurchaseReturnOrderNewRoute() {
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");
  const purchaseOrderId = params.get("purchaseOrderId");
  const { company, defaults } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    purchaseReturnOrderId: undefined,
    supplierId: supplierId ?? "",
    purchaseOrderId: purchaseOrderId ?? undefined,
    orderDate: companyToday,
    expirationDate: "",
    status: "Draft" as const,
    currencyCode: company?.baseCurrencyCode ?? "USD",
    locationId: defaults?.locationId ?? ""
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <PurchaseReturnOrderForm initialValues={initialValues} />
    </div>
  );
}
