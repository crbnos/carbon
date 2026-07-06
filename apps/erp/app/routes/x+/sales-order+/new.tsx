import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import { insertSalesOrder, salesOrderValidator } from "~/modules/sales";
import { SalesOrderForm } from "~/modules/sales/ui/SalesOrder";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Orders`,
  to: path.to.salesOrders
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "sales",
      bypassRls: true
    });

  const formData = await request.formData();
  const validation = await validator(salesOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...data } = validation.data;

  const result = await insertSalesOrder(client, {
    ...data,
    salesOrderId: data.salesOrderId || undefined,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.salesOrders,
      await flash(request, error(result.error, "Failed to insert sales order"))
    );
  }

  throw redirect(path.to.salesOrder(result.data.id));
}

export default function SalesOrderNewRoute() {
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const { id: userId, company, defaults } = useUser();

  const initialValues = {
    id: undefined,
    salesOrderId: undefined,
    customerId: customerId ?? "",
    orderDate: "",
    status: "Draft" as const,
    currencyCode: company?.baseCurrencyCode ?? "USD",
    locationId: defaults?.locationId ?? "",
    salesPersonId: userId,
    exchangeRate: undefined,
    exchangeRateUpdatedAt: "",
    originatedFromQuote: false,
    digitalQuoteAcceptedBy: undefined,
    digitalQuoteAcceptedByEmail: undefined
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SalesOrderForm initialValues={initialValues} />
    </div>
  );
}
