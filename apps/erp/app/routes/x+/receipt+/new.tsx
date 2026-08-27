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
      // One open draft per RMA: clicking Receive again goes to the existing
      // draft instead of stacking up duplicates.
      const existingReturnReceipt = await client
        .from("receipt")
        .select("id")
        .eq("sourceDocument", "Sales Return Order")
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", companyId)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingReturnReceipt.error) {
        throw redirect(
          path.to.salesReturnOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              existingReturnReceipt.error,
              "Failed to check for an existing receipt"
            )
          )
        );
      }
      if (existingReturnReceipt.data) {
        throw redirect(path.to.receiptDetails(existingReturnReceipt.data.id));
      }

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
    case "Repair Order": {
      // "intake" takes the customer's unit in; "return" takes it back from the
      // OEM. One open draft at a time, same as the RMA path.
      const repairLeg = (formData.get("leg") as string) === "return"
        ? "return"
        : "intake";

      const existingRepairReceipt = await client
        .from("receipt")
        .select("id")
        .eq("sourceDocument", "Repair Order")
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", companyId)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingRepairReceipt.data) {
        throw redirect(path.to.receiptDetails(existingRepairReceipt.data.id));
      }

      const repairReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptFromRepairOrder",
          companyId,
          locationId: defaults.data?.locationId,
          repairOrderId: sourceDocumentId,
          leg: repairLeg,
          receiptId: undefined,
          userId: userId
        }
      });
      if (!repairReceipt.data || repairReceipt.error) {
        throw redirect(
          path.to.repairOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              repairReceipt.error,
              await getEdgeFunctionErrorMessage(
                repairReceipt.error,
                "Failed to create receipt"
              )
            )
          )
        );
      }

      throw redirect(path.to.receiptDetails(repairReceipt.data.id));
    }
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
