import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { ReceiptSourceDocument } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
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

  const defaults = await getUserDefaults(client, userId, companyId);
  const serviceRole = getCarbonServiceRole();

  switch (sourceDocument) {
    case "Purchase Order":
      const purchaseOrderReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptFromPurchaseOrder",
          companyId,
          locationId: defaults.data?.locationId,
          purchaseOrderId: sourceDocumentId,
          receiptId: undefined,
          userId: userId
        }
      });
      if (!purchaseOrderReceipt.data || purchaseOrderReceipt.error) {
        throw redirect(
          path.to.purchaseOrder(sourceDocumentId),
          await flash(
            request,
            error(purchaseOrderReceipt.error, "Failed to create receipt")
          )
        );
      }

      throw redirect(path.to.receiptDetails(purchaseOrderReceipt.data.id));
    case "Sales Return Order":
      // No default-location guard: the create edge function falls back to
      // the return order's own location and errors specifically otherwise.
      const salesReturnOrderReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptFromSalesReturnOrder",
          companyId,
          locationId: defaults.data?.locationId,
          salesReturnOrderId: sourceDocumentId,
          receiptId: undefined,
          userId: userId
        }
      });
      if (!salesReturnOrderReceipt.data || salesReturnOrderReceipt.error) {
        throw redirect(
          path.to.salesReturnOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              salesReturnOrderReceipt.error,
              await getEdgeFunctionErrorMessage(
                salesReturnOrderReceipt.error,
                "Failed to create receipt"
              )
            )
          )
        );
      }

      throw redirect(path.to.receiptDetails(salesReturnOrderReceipt.data.id));
    case "Inbound Transfer":
      const warehouseTransferReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptFromInboundTransfer",
          companyId,
          warehouseTransferId: sourceDocumentId,
          receiptId: undefined,
          userId: userId
        }
      });
      if (!warehouseTransferReceipt.data || warehouseTransferReceipt.error) {
        throw redirect(
          path.to.warehouseTransfer(sourceDocumentId),
          await flash(
            request,
            error(warehouseTransferReceipt.error, "Failed to create receipt")
          )
        );
      }

      throw redirect(path.to.receiptDetails(warehouseTransferReceipt.data.id));
    default:
      const defaultReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptDefault",
          companyId,
          locationId: defaults.data?.locationId,
          userId: userId
        }
      });

      if (!defaultReceipt.data || defaultReceipt.error) {
        throw redirect(
          path.to.receipts,
          await flash(request, error(error, "Failed to create receipt"))
        );
      }

      throw redirect(path.to.receiptDetails(defaultReceipt.data.id));
  }
}
