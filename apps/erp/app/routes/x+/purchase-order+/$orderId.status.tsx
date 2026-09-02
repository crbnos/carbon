import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { runMRP } from "~/modules/production";
import {
  canCreatePurchaseOrderRevision,
  isPurchaseOrderLocked,
  purchaseOrderStatusType,
  reopenPurchaseOrderAsRevision,
  updatePurchaseOrderStatus
} from "~/modules/purchasing";
import { canApproveRequest } from "~/modules/shared";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "orderid-status");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

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

  // First get current PO status with view permission
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  const currentPo = await viewClient
    .from("purchaseOrder")
    .select("status, orderDate")
    .eq("id", id)
    .single();

  const currentStatus = currentPo.data?.status;
  const isCurrentlyLocked = isPurchaseOrderLocked(currentStatus);

  // Explicit request only — a plain Reopen never bumps.
  const createRevisionRequested =
    status === "Draft" && formData.get("createRevision") === "true";

  // Reject an ineligible revision BEFORE the Draft branch below cancels pending
  // approvals: those side effects must not be applied for a request that is
  // about to fail. reopenPurchaseOrderAsRevision re-checks the same conditions
  // in SQL, so this is a pre-flight, not the authority.
  if (
    createRevisionRequested &&
    !canCreatePurchaseOrderRevision({
      newStatus: status,
      currentStatus,
      orderDate: currentPo.data?.orderDate
    })
  ) {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseOrder(id),
      await flash(
        request,
        error(null, "Only a released purchase order can be revised")
      )
    );
  }

  // Determine required permission:
  // - Reopening (Draft) from a locked status requires delete permission
  // - Closing from any status requires delete permission
  // - Other status changes require update permission
  const requiresDeletePermission =
    (status === "Draft" && isCurrentlyLocked) || status === "Closed";

  const { client, userId, companyId } = await requirePermissions(request, {
    ...(requiresDeletePermission
      ? { delete: "purchasing" }
      : { update: "purchasing" })
  });

  const serviceRole = getCarbonServiceRole();

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
      logger.info(
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

  if (createRevisionRequested) {
    let rowsUpdated = 0;
    try {
      rowsUpdated = await reopenPurchaseOrderAsRevision(getDatabaseClient(), {
        id,
        companyId,
        updatedBy: userId
      });
    } catch (err) {
      logger.error("Failed to create purchase order revision", { error: err });
      throw redirect(
        requestReferrer(request) ?? path.to.purchaseOrder(id),
        await flash(request, error(err, "Failed to create revision"))
      );
    }

    if (rowsUpdated === 0) {
      throw redirect(
        requestReferrer(request) ?? path.to.purchaseOrder(id),
        await flash(
          request,
          error(null, "Only a released purchase order can be revised")
        )
      );
    }

    throw redirect(
      requestReferrer(request) ?? path.to.purchaseOrder(id),
      await flash(request, success("Created a new purchase order revision"))
    );
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
    await runMRP(serviceRole, getDatabaseClient(), {
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
