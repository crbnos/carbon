import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import {
  deletePurchaseOrderLine,
  getPurchaseOrderLine,
} from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });
  const { lineId, orderId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!orderId) throw notFound("orderId not found");

  const purchaseOrderLine = await getPurchaseOrderLine(client, lineId);
  if (purchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderLines(orderId),
      await flash(
        request,
        error(purchaseOrderLine.error, "Failed to get purchase order line")
      )
    );
  }

  return json({ purchaseOrderLine: purchaseOrderLine.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });

  const { lineId, orderId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  const { error: deleteTypeError } = await deletePurchaseOrderLine(
    client,
    lineId
  );
  if (deleteTypeError) {
    throw redirect(
      path.to.purchaseOrderLines(orderId),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete purchase order line")
      )
    );
  }

  throw redirect(
    path.to.purchaseOrderLines(orderId),
    await flash(request, success("Successfully deleted purchase order line"))
  );
}

export default function DeletePurchaseOrderLineRoute() {
  const { lineId, orderId } = useParams();
  const { purchaseOrderLine } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!purchaseOrderLine) return null;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  const onCancel = () => navigate(path.to.purchaseOrderLines(orderId));

  return (
    <ConfirmDelete
      action={path.to.deletePurchaseOrderLine(orderId, lineId)}
      name="Purchase Order Line"
      text={`Are you sure you want to delete the purchase order line for ${
        purchaseOrderLine.purchaseQuantity ?? 0
      } ${purchaseOrderLine.description ?? ""}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
