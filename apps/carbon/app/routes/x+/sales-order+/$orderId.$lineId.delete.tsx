import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { deleteSalesOrderLine, getSalesOrderLine } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path, requestReferrer } from "~/utils/path";
import { error, success } from "~/utils/result";

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
