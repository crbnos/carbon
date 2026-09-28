import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { ReceiptSourceDocument } from "~/modules/inventory";
import { createReceipt } from "~/modules/inventory/inventory.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Receipts`,
  to: path.to.receipts
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const sourceDocument =
    (formData.get("sourceDocument") as ReceiptSourceDocument) ?? undefined;
  const sourceDocumentId = (formData.get("sourceDocumentId") as string) ?? "";

  // Shared with the inventory_createReceipt tool.
  const result = await createReceipt(client, {
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

  throw redirect(path.to.receiptDetails(result.data.id));
}

function sourceErrorPath(
  sourceDocument: ReceiptSourceDocument | undefined,
  sourceDocumentId: string
) {
  switch (sourceDocument) {
    case "Purchase Order":
      return path.to.purchaseOrder(sourceDocumentId);
    case "Sales Return Order":
      return path.to.salesReturnOrderDetails(sourceDocumentId);
    case "Inbound Transfer":
      return path.to.warehouseTransfer(sourceDocumentId);
    default:
      return path.to.receipts;
  }
}
