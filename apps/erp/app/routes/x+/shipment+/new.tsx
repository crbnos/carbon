import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { ShipmentSourceDocument } from "~/modules/inventory";
import { createShipment } from "~/modules/inventory/inventory.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Shipments`,
  to: path.to.shipments
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const sourceDocument =
    (formData.get("sourceDocument") as ShipmentSourceDocument) ?? undefined;
  const sourceDocumentId = (formData.get("sourceDocumentId") as string) ?? "";

  // Shared with the inventory_createShipment tool.
  const result = await createShipment(client, {
    companyId,
    userId,
    sourceDocument,
    sourceDocumentId
  });

  if (result.error) {
    throw redirect(
      sourceErrorPath(sourceDocument, sourceDocumentId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  throw redirect(path.to.shipmentDetails(result.data.id));
}

function sourceErrorPath(
  sourceDocument: ShipmentSourceDocument | undefined,
  sourceDocumentId: string
) {
  switch (sourceDocument) {
    case "Sales Order":
      return path.to.salesOrder(sourceDocumentId);
    case "Sales Return Order":
      return path.to.salesReturnOrderDetails(sourceDocumentId);
    case "Purchase Return Order":
      return path.to.purchaseReturnOrderDetails(sourceDocumentId);
    case "Purchase Order":
      return path.to.purchaseOrder(sourceDocumentId);
    case "Outbound Transfer":
      return path.to.warehouseTransferDetails(sourceDocumentId);
    default:
      return path.to.shipments;
  }
}
