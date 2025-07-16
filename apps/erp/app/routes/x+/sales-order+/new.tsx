import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import { salesOrderValidator, upsertSalesOrder } from "~/modules/sales";
import { SalesOrderForm } from "~/modules/sales/ui/SalesOrder";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.salesOrders,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
    bypassRls: true,
  });

  const formData = await request.formData();
  const validation = await validator(salesOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  let salesOrderId = data.salesOrderId;
  const useNextSequence = !salesOrderId;

  if (useNextSequence) {
    const nextSequence = await getNextSequence(client, "salesOrder", companyId);
    if (nextSequence.error) {
      throw redirect(
        path.to.newSalesOrder,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    salesOrderId = nextSequence.data;
  }

  if (!salesOrderId) throw new Error("salesOrderId is not defined");

  const createSalesOrder = await upsertSalesOrder(client, {
    ...data,
    salesOrderId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSalesOrder.error || !createSalesOrder.data?.[0]) {
    throw redirect(
      path.to.salesOrders,
      await flash(
        request,
        error(createSalesOrder.error, "Failed to insert sales order")
      )
    );
  }

  const order = createSalesOrder.data?.[0];

  throw redirect(path.to.salesOrder(order.id!));
}

export default function SalesOrderNewRoute() {
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const { id: userId, company, defaults } = useUser();

  const initialValues = {
    id: undefined,
    salesOrderId: undefined,
    customerId: customerId ?? "",
    orderDate: today(getLocalTimeZone()).toString(),
    status: "Draft" as const,
    currencyCode: company?.baseCurrencyCode ?? "USD",
    locationId: defaults?.locationId ?? "",
    salesPersonId: userId,
    exchangeRate: undefined,
    exchangeRateUpdatedAt: "",
    originatedFromQuote: false,
    digitalQuoteAcceptedBy: undefined,
    digitalQuoteAcceptedByEmail: undefined,
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SalesOrderForm initialValues={initialValues} />
    </div>
  );
}
