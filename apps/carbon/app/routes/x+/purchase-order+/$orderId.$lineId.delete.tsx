import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
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
      path.to.purchaseOrderDetails(orderId),
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
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete purchase order line")
      )
    );
  }

  throw redirect(
    path.to.purchaseOrderDetails(orderId),
    await flash(request, success("Successfully deleted purchase order line"))
  );
}
