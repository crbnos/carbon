import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteSalesOrderLine, getSalesOrderLine } from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });
  const { lineId, orderId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!orderId) throw notFound("orderId not found");

  const salesOrderLine = await getSalesOrderLine(client, lineId);
  if (salesOrderLine.error) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(
        request,
        error(salesOrderLine.error, "Failed to get sales order line")
      )
    );
  }

  return json({ salesOrderLine: salesOrderLine.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { lineId, orderId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  const { error: deleteTypeError } = await deleteSalesOrderLine(client, lineId);
  if (deleteTypeError) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesOrder(orderId),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete sales order line")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.salesOrder(orderId),
    await flash(request, success("Successfully deleted sales order line"))
  );
}

export default function DeleteSalesOrderLineRoute() {
  const { lineId, orderId } = useParams();
  const { salesOrderLine } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!salesOrderLine) return null;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteSalesOrderLine(orderId, lineId)}
      name="Sales Order Line"
      text={`Are you sure you want to delete the sales order line for ${
        salesOrderLine.saleQuantity ?? 0
      } ${salesOrderLine.description ?? ""}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
