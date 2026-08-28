import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import {
  insertSalesReturnOrder,
  salesReturnOrderValidator
} from "~/modules/sales";
import { SalesReturnOrderForm } from "~/modules/sales/ui/SalesReturnOrders";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`RMAs`,
  to: path.to.salesReturnOrders
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "sales",
      bypassRls: true
    });

  const formData = await request.formData();
  const validation = await validator(salesReturnOrderValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, status: _status, ...data } = validation.data;

  const result = await insertSalesReturnOrder(client, {
    ...data,
    salesReturnOrderId: data.salesReturnOrderId || undefined,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.salesReturnOrders,
      await flash(
        request,
        error(result.error, "Failed to insert sales return order")
      )
    );
  }

  throw redirect(path.to.salesReturnOrderDetails(result.data.id));
}

export default function SalesReturnOrderNewRoute() {
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const salesOrderId = params.get("salesOrderId");
  const { company, defaults } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    salesReturnOrderId: undefined,
    customerId: customerId ?? "",
    salesOrderId: salesOrderId ?? undefined,
    orderDate: companyToday,
    expirationDate: "",
    status: "Draft" as const,
    currencyCode: company?.baseCurrencyCode ?? "USD",
    locationId: defaults?.locationId ?? ""
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SalesReturnOrderForm initialValues={initialValues} />
    </div>
  );
}
