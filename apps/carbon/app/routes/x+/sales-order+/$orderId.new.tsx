import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import type { SalesOrderLineType } from "~/modules/sales";
import {
  SalesOrderLineForm,
  salesOrderLineValidator,
  upsertSalesOrderLine,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(salesOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createSalesOrderLine = await upsertSalesOrderLine(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSalesOrderLine.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(createSalesOrderLine.error, "Failed to create sales order line.")
      )
    );
  }

  const salesOrderLineId = createSalesOrderLine.data.id;

  throw redirect(path.to.salesOrderLine(orderId, salesOrderLineId));
}

export default function NewSalesOrderLineRoute() {
  const { orderId } = useParams();

  if (!orderId) throw new Error("Could not find sales order id");

  const initialValues = {
    salesOrderId: orderId,
    salesOrderLineType: "Part" as SalesOrderLineType,
    itemId: "",
    saleQuantity: 1,
    setupPrice: 0,
    shelfId: "",
    unitOfMeasureCode: "",
    unitPrice: 0,
  };

  return <SalesOrderLineForm initialValues={initialValues} />;
}
