import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  notFound
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deletePurchaseOrder, getPurchaseOrder } from "~/modules/purchasing";
import {
  canApproveRequest,
  canCancelRequest,
  getLatestApprovalRequestForDocument
} from "~/modules/shared";

import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { orderId } = params;
  if (!orderId) throw notFound("orderId not found");

  const serviceRole = getCarbonServiceRole();

  // Get PO status and check if it's in "Needs Approval"
  const purchaseOrder = await getPurchaseOrder(serviceRole, orderId);
  if (purchaseOrder.error || !purchaseOrder.data) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(
          purchaseOrder.error ?? new Error("Purchase order not found"),
          "Purchase order not found"
        )
      )
    );
  }

  const poStatus = purchaseOrder.data.status;

  // If PO is in "Needs Approval", check permissions
  if (poStatus && poStatus === "Needs Approval") {
    const approvalRequest = await getLatestApprovalRequestForDocument(
      serviceRole,
      "purchaseOrder",
      orderId
    );

    if (
      approvalRequest.data &&
      approvalRequest.data.status === "Pending" &&
      approvalRequest.data.requestedBy
    ) {
      const isRequester = canCancelRequest(
        {
          requestedBy: approvalRequest.data.requestedBy,
          status: approvalRequest.data.status as "Pending"
        },
        userId
      );
      const isApprover = await canApproveRequest(
        serviceRole,
        {
          amount: approvalRequest.data.amount,
          documentType: approvalRequest.data.documentType,
          companyId: approvalRequest.data.companyId
        },
        userId
      );

      // Only requester can delete POs in "Needs Approval" status
      // Approvers should reject instead, normal users have no permission
      if (!isRequester) {
        throw redirect(
          path.to.purchaseOrder(orderId),
          await flash(
            request,
            error(
              new Error(
                isApprover
                  ? "Approvers cannot delete purchase orders. Please reject the approval request instead."
                  : "Only the requester can delete a purchase order that needs approval"
              ),
              isApprover
                ? "Please reject the approval request instead of deleting"
                : "You do not have permission to delete this purchase order"
            )
          )
        );
      }

      // Cancel pending approval requests before deletion
      await serviceRole
        .from("approvalRequest")
        .update({
          status: "Cancelled",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("documentType", "purchaseOrder")
        .eq("documentId", orderId)
        .eq("status", "Pending");
    }
  }

  // Only allow deletion of Draft, Planned, or Needs Approval (if requester) statuses
  if (!poStatus || !["Draft", "Planned", "Needs Approval"].includes(poStatus)) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(
          new Error("Cannot delete purchase order in this status"),
          `Cannot delete purchase order with status "${poStatus ?? "unknown"}". Only Draft, Planned, or Needs Approval (if you're the requester) purchase orders can be deleted.`
        )
      )
    );
  }

  const remove = await deletePurchaseOrder(client, orderId);

  if (remove.error) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(request, error(remove.error, remove.error.message))
    );
  }

  throw redirect(path.to.purchaseOrders);
}
