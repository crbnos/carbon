import type { Database } from "@carbon/database";
import {
  canApproveRequest,
  getLatestApprovalRequestForDocument
} from "@carbon/ee/approvals.server";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Cancels the purchase order's pending approval requests, as closing it does:
 * a closed order is terminal, so nothing may stay awaiting a decision.
 * Approved and Rejected requests are kept as the audit trail. Returns how many
 * requests were cancelled.
 *
 * `approvalRequest` has RLS on and no policies, so this needs the service
 * role. The caller must first prove the order belongs to `companyId`
 * (`requireCompanyRecord`); the write is keyed on `purchaseOrderId`.
 */
export async function cancelPendingPurchaseOrderApprovals(
  serviceRole: SupabaseClient<Database>,
  args: { purchaseOrderId: string; companyId: string; userId: string }
) {
  const result = await serviceRole
    .from("approvalRequest")
    .update({
      status: "Cancelled",
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("documentType", "purchaseOrder")
    .eq("documentId", args.purchaseOrderId)
    .eq("companyId", args.companyId)
    .eq("status", "Pending")
    .select("id");

  return {
    cancelled: result.data?.length ?? 0,
    error: result.error
  };
}
