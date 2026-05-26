import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { isSalesOrderLocked } from "~/modules/sales";
import {
  deleteSalesOrderLine,
  getSalesOrder,
  getSalesOrderLine
} from "~/modules/sales/sales.service.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    delete: "sales"
  });
  const { lineId, orderId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!orderId) throw notFound("orderId not found");

  const salesOrderLine = await getSalesOrderLine(lineId);
  if (salesOrderLine.error) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(
        request,
        error(salesOrderLine.error, "Failed to get sales order line")
      )
    );
  }

  return { salesOrderLine: salesOrderLine.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { lineId, orderId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  await requirePermissions(request, {
    view: "sales"
  });

  const salesOrder = await getSalesOrder(orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrder(orderId),
    message: "Cannot delete lines on a locked sales order. Reopen it first."
  });

  await requirePermissions(request, {
    delete: "sales"
  });

  const { error: deleteTypeError } = await deleteSalesOrderLine(lineId);
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
  const { t } = useLingui();
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
      name={t`Sales Order Line`}
      text={t`Are you sure you want to delete the sales order line for ${
        salesOrderLine.saleQuantity ?? 0
      } ${salesOrderLine.description ?? ""}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
