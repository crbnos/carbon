import { validationError, validator } from "@carbon/remix-validated-form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useUrlParams } from "~/hooks";
import type { SalesOrderStatus } from "~/modules/sales";
import {
  SalesOrderForm,
  salesOrderValidator,
  upsertSalesOrder,
} from "~/modules/sales";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(salesOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

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

  const { id, salesOrderId, ...data } = validation.data;

  const createSalesOrder = await upsertSalesOrder(client, {
    salesOrderId: nextSequence.data,
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSalesOrder.error || !createSalesOrder.data?.[0]) {
    // TODO: this should be done as a transaction
    await rollbackNextSequence(client, "salesOrder", companyId);
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
  const initialValues = {
    id: undefined,
    salesOrderId: undefined,
    customerId: customerId ?? "",
    orderDate: today(getLocalTimeZone()).toString(),
    status: "Draft" as SalesOrderStatus,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <SalesOrderForm initialValues={initialValues} />
    </div>
  );
}
