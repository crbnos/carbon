import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import type { SalesOrderLineType } from "~/modules/sales";
import {
  SalesOrderLineForm,
  getSalesOrderLine,
  salesOrderLineValidator,
  upsertSalesOrderLine,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const salesOrderLine = await getSalesOrderLine(client, lineId);

  return json({
    salesOrderLine: salesOrderLine?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const validation = await validator(salesOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (data.salesOrderLineType === "Comment") {
    data.accountNumber = undefined;
    data.assetId = undefined;
    data.itemId = undefined;
  } else if (data.salesOrderLineType === "Fixed Asset") {
    data.accountNumber = undefined;
    data.itemId = undefined;
  } else {
    data.accountNumber = undefined;
    data.assetId = undefined;
  }

  const updateSalesOrderLine = await upsertSalesOrderLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateSalesOrderLine.error) {
    throw redirect(
      path.to.salesOrderLines(orderId),
      await flash(
        request,
        error(updateSalesOrderLine.error, "Failed to update sales order line")
      )
    );
  }

  throw redirect(path.to.salesOrderLines(orderId));
}

export default function EditSalesOrderLineRoute() {
  const { salesOrderLine } = useLoaderData<typeof loader>();

  const initialValues = {
    id: salesOrderLine?.id ?? undefined,
    salesOrderId: salesOrderLine?.salesOrderId ?? "",
    salesOrderLineType:
      salesOrderLine?.salesOrderLineType ?? ("Part" as SalesOrderLineType),
    itemId: salesOrderLine?.itemId ?? "",
    itemReadableId: salesOrderLine?.itemReadableId ?? "",
    accountNumber: salesOrderLine?.accountNumber ?? "",
    assetId: salesOrderLine?.assetId ?? "",
    description: salesOrderLine?.description ?? "",
    saleQuantity: salesOrderLine?.saleQuantity ?? 1,
    unitPrice: salesOrderLine?.unitPrice ?? 0,
    setupPrice: salesOrderLine?.setupPrice ?? 0,
    unitOfMeasureCode: salesOrderLine?.unitOfMeasureCode ?? "",
    shelfId: salesOrderLine?.shelfId ?? "",
    ...getCustomFields(salesOrderLine?.customFields),
  };

  return (
    <SalesOrderLineForm key={initialValues.id} initialValues={initialValues} />
  );
}
