import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  canApproveRequest,
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  getLatestApprovalRequestForDocument,
  hasPendingApproval,
  isApprovalRequired
} from "@carbon/ee/approvals.server";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanySettings } from "~/modules/settings/settings.service";
import {
  type CommandResult,
  commandFailed,
  commandOk
} from "~/services/command-result";
import {
  finalizePurchaseOrder,
  getPurchaseOrder,
  getSupplier,
  updatePurchaseOrderStatus
} from "./purchasing.service";

/**
 * Server-only purchasing helpers. Lives in a `.server.ts` (NOT the barrel-exported
 * `purchasing.service.ts`) because it imports the commercial, server-only approval
 * engine `@carbon/ee/approvals.server`; a `.server` import reaching the client
 * graph via the module barrel is rejected by the React Router build.
 */

type ApprovalContext = {
  approvalRequest: { id: string } | null;
  canApprove: boolean;
  decision: {
    status: "Approved" | "Rejected";
    decisionBy: string;
    decisionAt: string;
  } | null;
};

export async function getSupplierApprovalContext(
  serviceRole: SupabaseClient<Database>,
  supplierId: string,
  status: string | null,
  companyId: string,
  userId: string
): Promise<ApprovalContext> {
  const latest = await getLatestApprovalRequestForDocument(
    serviceRole,
    "supplier",
    supplierId
  );

  const req = latest.data;

  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: req?.amount ?? null,
      documentType: "supplier",
      companyId
    },
    userId
  );

  // Look for the latest terminal decision (Approved or Rejected)
  let decision: ApprovalContext["decision"] = null;
  const terminalRequest = await serviceRole
    .from("approvalRequest")
    .select("status, decisionBy, decisionAt")
    .eq("documentType", "supplier")
    .eq("documentId", supplierId)
    .in("status", ["Approved", "Rejected"])
    .order("decisionAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    terminalRequest.data?.decisionBy &&
    terminalRequest.data?.decisionAt &&
    (terminalRequest.data.status === "Approved" ||
      terminalRequest.data.status === "Rejected")
  ) {
    decision = {
      status: terminalRequest.data.status,
      decisionBy: terminalRequest.data.decisionBy,
      decisionAt: terminalRequest.data.decisionAt
    };
  }

  if (!req || req.status !== "Pending" || !req.requestedBy || !req.id) {
    return {
      approvalRequest: null,
      canApprove,
      decision
    };
  }

  return {
    approvalRequest: { id: req.id },
    canApprove,
    decision
  };
}

const finalizeLogger = getLogger("erp", "purchase-order-finalize");

/**
 * The part of the purchase order Finalize action that commits the order
 * (`x+/purchase-order+/$orderId.finalize.tsx`), shared by the route and the
 * `purchasing_finalizePurchaseOrder` tool:
 * - refused when supplier approval is required and the supplier is not Active;
 * - the order's status is derived from its lines and the order date stamped;
 * - when the order total needs approval, an approval request is created (once),
 *   the approvers are notified and the order moves to Needs Approval;
 * - otherwise purchased prices are updated when the company updates them on
 *   finalize.
 *
 * The route then renders the PDF, stores it and optionally emails the
 * supplier; those steps are not part of this command.
 */
export async function commitPurchaseOrderFinalize(
  client: SupabaseClient<Database>,
  args: { purchaseOrderId: string; companyId: string; userId: string }
): Promise<CommandResult<{ id: string; approvalRequired: boolean }>> {
  const { purchaseOrderId: orderId, companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();

  const purchaseOrder = await getPurchaseOrder(serviceRole, orderId);
  if (purchaseOrder.error || !purchaseOrder.data) {
    return commandFailed("Failed to get purchase order", purchaseOrder.error);
  }
  if (purchaseOrder.data.companyId !== companyId) {
    return commandFailed(
      "You are not authorized to finalize this purchase order"
    );
  }

  const supplierApprovalRequired = await isApprovalRequired(
    serviceRole,
    "supplier",
    companyId
  );
  if (supplierApprovalRequired && purchaseOrder.data.supplierId) {
    const supplier = await getSupplier(
      serviceRole,
      purchaseOrder.data.supplierId
    );
    if (supplier.data?.status !== "Active") {
      return commandFailed(
        "Cannot finalize: supplier is not approved (Active)"
      );
    }
  }

  const orderAmount = purchaseOrder.data.orderTotal ?? 0;
  const approvalRequired = await isApprovalRequired(
    serviceRole,
    "purchaseOrder",
    companyId,
    orderAmount
  );

  const finalize = await finalizePurchaseOrder(client, orderId, userId);
  if (finalize.error) {
    return commandFailed("Failed to finalize purchase order", finalize.error);
  }

  // Emitted as soon as the order is finalized: every later step can fail and
  // still leaves a finalized order behind.
  trackWorkEvent(
    "purchase_order_finalized",
    {
      companyId,
      userId,
      purchaseOrderId: orderId,
      stage: approvalRequired ? "gated" : "committed"
    },
    { discriminator: approvalRequired ? "gated" : "committed" }
  );

  // PDF generation, email and price updates happen after approval.
  if (approvalRequired) {
    const hasPending = await hasPendingApproval(
      serviceRole,
      "purchaseOrder",
      orderId
    );
    if (!hasPending) {
      await createApprovalRequest(serviceRole, {
        documentType: "purchaseOrder",
        documentId: orderId,
        companyId,
        requestedBy: userId,
        createdBy: userId,
        amount: orderAmount
      });

      const rule = await getApprovalRuleByAmount(
        serviceRole,
        "purchaseOrder",
        companyId,
        orderAmount
      );
      const approverIds = rule.data
        ? await getApproverUserIdsForRule(serviceRole, rule.data)
        : [];
      if (approverIds.length > 0) {
        try {
          await trigger("notify", {
            event: NotificationEvent.ApprovalRequested,
            companyId,
            documentId: orderId,
            documentType: "purchaseOrder",
            recipient: { type: "users", userIds: approverIds },
            from: userId
          });
        } catch (e) {
          finalizeLogger.error("Failed to trigger approval notification", {
            error: e
          });
        }
      }
    }

    await updatePurchaseOrderStatus(client, {
      id: orderId,
      status: "Needs Approval",
      assignee: undefined,
      updatedBy: userId
    });
    return commandOk({ id: orderId, approvalRequired: true });
  }

  const companySettings = await getCompanySettings(serviceRole, companyId);
  if (
    companySettings.data?.purchasePriceUpdateTiming ===
    "Purchase Order Finalize"
  ) {
    const priceUpdate = await serviceRole.functions.invoke(
      "update-purchased-prices",
      {
        body: {
          purchaseOrderId: orderId,
          companyId,
          userId,
          source: "purchaseOrder",
          updatePrices: true,
          updateLeadTimes: false
        }
      }
    );
    if (priceUpdate.error) {
      // Never fails the finalization.
      finalizeLogger.error("Failed to update purchased prices", {
        error: priceUpdate.error
      });
    }
  }

  return commandOk({ id: orderId, approvalRequired: false });
}
