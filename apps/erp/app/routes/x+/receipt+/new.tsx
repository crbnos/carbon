// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import type { ReceiptSourceDocument } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
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

  switch (sourceDocument) {
    case "Purchase Order":
      const purchaseOrderReceipt = await serverFns
        .system({ db: getDatabaseClient(), companyId, userId })
        .invoke("create", {
          type: "receiptFromPurchaseOrder",
          locationId: defaults.data?.locationId as string | undefined,
          purchaseOrderId: sourceDocumentId,
          receiptId: undefined
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

      // No default-location guard: the create server function falls back to
      // the return order's own location and errors specifically otherwise.
      const salesReturnOrderReceipt = await serverFns
        .system({ db: getDatabaseClient(), companyId, userId })
        .invoke("create", {
          type: "receiptFromSalesReturnOrder",
          locationId: defaults.data?.locationId as string | undefined,
          salesReturnOrderId: sourceDocumentId,
          receiptId: undefined
        });
      if (!salesReturnOrderReceipt.data || salesReturnOrderReceipt.error) {
        throw redirect(
          path.to.salesReturnOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              salesReturnOrderReceipt.error,
              getErrorMessage(
                salesReturnOrderReceipt.error,
                "Failed to create receipt"
              )
            )
          )
        );
      }

      throw redirect(path.to.receiptDetails(salesReturnOrderReceipt.data.id));
    case "Inbound Transfer":
      const warehouseTransferReceipt = await serverFns
        .system({ db: getDatabaseClient(), companyId, userId })
        .invoke("create", {
          type: "receiptFromInboundTransfer",
          warehouseTransferId: sourceDocumentId,
          receiptId: undefined
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
      const defaultReceipt = await serverFns
        .system({ db: getDatabaseClient(), companyId, userId })
        .invoke("create", {
          type: "receiptDefault",
          locationId: defaults.data?.locationId as string
        });

      if (!defaultReceipt.data || defaultReceipt.error) {
        throw redirect(
          path.to.receipts,
          await flash(
            request,
            error(defaultReceipt.error, "Failed to create receipt")
          )
        );
      }

      throw redirect(path.to.receiptDetails(defaultReceipt.data.id));
  }
}
