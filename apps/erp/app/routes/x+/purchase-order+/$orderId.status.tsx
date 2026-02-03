import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { runMRP } from "~/modules/production";
import {
  purchaseOrderStatusType,
  updatePurchaseOrderStatus
} from "~/modules/purchasing";
import { canApproveRequest } from "~/modules/shared";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { orderId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof purchaseOrderStatusType)[number];

  if (!status || !purchaseOrderStatusType.includes(status)) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const serviceRole = getCarbonServiceRole();

  // Get current PO status before updating
  const currentPo = await client
    .from("purchaseOrder")
    .select("status")
    .eq("id", id)
    .single();

  const currentStatus = currentPo.data?.status;

  // Cancel pending approval requests when closing the PO
  // Closed POs are terminal - no approvals should remain pending
  // Note: Approved/Rejected requests are NOT cancelled - they serve as audit trail
  // Only "Pending" requests are cancelled since they're no longer actionable
  if (status === "Closed") {
    // Find all pending approval requests for this PO and cancel them
    const cancelResult = await serviceRole
      .from("approvalRequest")
      .update({
        status: "Cancelled",
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("documentType", "purchaseOrder")
      .eq("documentId", id)
      .eq("status", "Pending")
      .select("id");

    if (cancelResult.data && cancelResult.data.length > 0) {
      console.log(
        `Cancelled ${cancelResult.data.length} pending approval request(s) for PO ${id} when closing`
      );
    }
  }

  // Cancel pending approval requests when reopening to Draft
  // This handles reopening from both "Needs Approval" and "Closed" statuses
  if (status === "Draft") {
    // Find all pending approval requests for this PO
    const pendingApprovals = await serviceRole
      .from("approvalRequest")
      .select("*")
      .eq("documentType", "purchaseOrder")
      .eq("documentId", id)
      .eq("status", "Pending");

    if (pendingApprovals.data && pendingApprovals.data.length > 0) {
      if (currentStatus === "Closed") {
        // System action when reopening from Closed - cancel all regardless of requester
        await serviceRole
          .from("approvalRequest")
          .update({
            status: "Cancelled",
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("documentType", "purchaseOrder")
          .eq("documentId", id)
          .eq("status", "Pending");
      } else if (currentStatus === "Needs Approval") {
        // Security check: Only allow reopening if user is the requester OR an approver
        // This prevents non-approvers from bypassing the approval workflow
        const latestApproval = pendingApprovals.data[0]; // Get the latest pending request
        const isRequester = latestApproval.requestedBy === userId;
        const isApprover = await canApproveRequest(
          serviceRole,
          {
            amount: latestApproval.amount,
            documentType: latestApproval.documentType,
            companyId: latestApproval.companyId
          },
          userId
        );

        if (!isRequester && !isApprover) {
          throw redirect(
            requestReferrer(request) ?? path.to.quote(id),
            await flash(
              request,
              error(
                new Error(
                  "Only the requester or an approver can reopen a purchase order that needs approval"
                ),
                "You do not have permission to reopen this purchase order"
              )
            )
          );
        }

        // Cancel all pending approval requests when reopening (user has permission)
        await serviceRole
          .from("approvalRequest")
          .update({
            status: "Cancelled",
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("documentType", "purchaseOrder")
          .eq("documentId", id)
          .eq("status", "Pending");
      }
    }
  }

  const update = await updatePurchaseOrderStatus(client, {
    id,
    status,
    assignee: ["Closed"].includes(status) ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(
        request,
        error(update.error, "Failed to update purchasing order status")
      )
    );
  }

  if (status === "Planned") {
    await runMRP(serviceRole, {
      type: "purchaseOrder",
      id,
      companyId,
      userId
    });
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated purchasing order status"))
  );
}
