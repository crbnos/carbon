// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approveRequest,
  canApproveRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  isApprovalRequired,
  rejectRequest
} from "./service";
import type {
  ApprovalDecision,
  ApprovalDocumentRef,
  ApprovalDocumentsRef,
  DocumentApprovalState
} from "./types";

// The document-level approval lifecycle (state, open, cancel, decide), shared by
// every approval document type. Each takes the service role: approvalRequest has
// no RLS policies. Notifications stay with the caller, because @carbon/ee must
// not depend on @carbon/jobs.

export async function getDocumentApprovalState(
  serviceRole: SupabaseClient<Database>,
  doc: ApprovalDocumentRef & { userId: string; amount?: number }
): Promise<DocumentApprovalState> {
  const [latest, isRequired, canApprove] = await Promise.all([
    serviceRole
      .from("approvalRequest")
      .select("id, status, requestedBy, decisionBy, decisionNotes, decisionAt")
      .eq("documentType", doc.documentType)
      .eq("documentId", doc.documentId)
      .eq("companyId", doc.companyId)
      .order("requestedAt", { ascending: false })
      .limit(1)
      .maybeSingle(),
    isApprovalRequired(
      serviceRole,
      doc.documentType,
      doc.companyId,
      doc.amount
    ),
    canApproveRequest(
      serviceRole,
      {
        amount: doc.amount ?? null,
        documentType: doc.documentType,
        companyId: doc.companyId
      },
      doc.userId
    )
  ]);

  const request = latest.data;
  const isPending = request?.status === "Pending";

  return {
    pendingRequestId: isPending ? request.id : null,
    pendingRequestedBy: isPending ? request.requestedBy : null,
    canApprove,
    isRequired,
    // The latest request's decision only: a newer pending or cancelled request
    // supersedes an older approval or rejection.
    lastDecision:
      request?.status === "Approved" || request?.status === "Rejected"
        ? {
            status: request.status,
            decisionBy: request.decisionBy,
            notes: request.decisionNotes,
            decisionAt: request.decisionAt
          }
        : null
  };
}

export type OpenApprovalResult =
  | { status: "not-required" }
  | { status: "failed" }
  | {
      status: "opened";
      /** Documents that got a new request. */
      requested: string[];
      /** Documents skipped because a request was already pending. */
      alreadyPending: string[];
      approverIds: string[];
    };

/**
 * Opens one request per document when an enabled rule applies. Takes several
 * documents because some screens change status in bulk; the rule, the pending
 * check and the insert are one query each. The caller notifies `approverIds`.
 */
export async function openApprovalRequests(
  serviceRole: SupabaseClient<Database>,
  docs: ApprovalDocumentsRef & { userId: string; amount?: number }
): Promise<OpenApprovalResult> {
  const rule = await getApprovalRuleByAmount(
    serviceRole,
    docs.documentType,
    docs.companyId,
    docs.amount
  );
  if (!rule.data) return { status: "not-required" };

  const pending = await serviceRole
    .from("approvalRequest")
    .select("documentId")
    .eq("documentType", docs.documentType)
    .in("documentId", docs.documentIds)
    .eq("companyId", docs.companyId)
    .eq("status", "Pending");
  if (pending.error) return { status: "failed" };

  const pendingIds = new Set((pending.data ?? []).map((r) => r.documentId));
  const requested = docs.documentIds.filter((id) => !pendingIds.has(id));

  if (requested.length > 0) {
    const created = await serviceRole.from("approvalRequest").insert(
      requested.map((documentId) => ({
        documentType: docs.documentType,
        documentId,
        companyId: docs.companyId,
        requestedBy: docs.userId,
        createdBy: docs.userId,
        amount: docs.amount ?? null
      }))
    );
    if (created.error) return { status: "failed" };
  }

  return {
    status: "opened",
    requested,
    alreadyPending: docs.documentIds.filter((id) => pendingIds.has(id)),
    approverIds:
      requested.length > 0
        ? await getApproverUserIdsForRule(serviceRole, rule.data)
        : []
  };
}

export type CancelApprovalsResult =
  | { error: null }
  | { error: { code: "forbidden" | "failed"; message: string } };

/**
 * Withdraws the pending requests of documents that were closed, deleted or sent
 * back. With `onlyRequesterOrApprover`, a user who neither asked for nor can
 * decide a request may not withdraw it.
 */
export async function cancelPendingApprovals(
  serviceRole: SupabaseClient<Database>,
  docs: ApprovalDocumentsRef & {
    userId: string;
    onlyRequesterOrApprover?: boolean;
  }
): Promise<CancelApprovalsResult> {
  if (docs.onlyRequesterOrApprover) {
    const [pending, canApprove] = await Promise.all([
      serviceRole
        .from("approvalRequest")
        .select("requestedBy")
        .eq("documentType", docs.documentType)
        .in("documentId", docs.documentIds)
        .eq("companyId", docs.companyId)
        .eq("status", "Pending"),
      canApproveRequest(
        serviceRole,
        {
          amount: null,
          documentType: docs.documentType,
          companyId: docs.companyId
        },
        docs.userId
      )
    ]);
    const othersRequests = (pending.data ?? []).some(
      (r) => r.requestedBy !== docs.userId
    );
    if (othersRequests && !canApprove) {
      return {
        error: {
          code: "forbidden",
          message:
            "Only the requester or an approver can withdraw a pending approval request"
        }
      };
    }
  }

  const cancelled = await serviceRole
    .from("approvalRequest")
    .update({
      status: "Cancelled",
      updatedBy: docs.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("documentType", docs.documentType)
    .in("documentId", docs.documentIds)
    .eq("companyId", docs.companyId)
    .eq("status", "Pending");

  return cancelled.error
    ? { error: { code: "failed", message: cancelled.error.message } }
    : { error: null };
}

export type DecideApprovalResult =
  | { error: null; requestedBy: string }
  | { error: { code: "not-found" | "forbidden" | "failed"; message: string } };

/**
 * Approves or rejects the document's pending request. The request id comes from
 * a form, so it must match the document's pending request and the caller's
 * company before `canApproveRequest` and the decision run.
 */
export async function decideApprovalRequest(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  doc: ApprovalDocumentRef & {
    userId: string;
    approvalRequestId: string;
    decision: ApprovalDecision;
    notes?: string;
  }
): Promise<DecideApprovalResult> {
  const pending = await serviceRole
    .from("approvalRequest")
    .select("id, amount, requestedBy")
    .eq("documentType", doc.documentType)
    .eq("documentId", doc.documentId)
    .eq("companyId", doc.companyId)
    .eq("status", "Pending")
    .eq("id", doc.approvalRequestId)
    .maybeSingle();

  if (!pending.data) {
    return {
      error: { code: "not-found", message: "Approval request not found" }
    };
  }

  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: pending.data.amount,
      documentType: doc.documentType,
      companyId: doc.companyId
    },
    doc.userId
  );
  if (!canApprove) {
    return {
      error: {
        code: "forbidden",
        message: "You do not have permission to approve this request"
      }
    };
  }

  const decide = doc.decision === "Approved" ? approveRequest : rejectRequest;
  const result = await decide(
    db,
    doc.approvalRequestId,
    doc.userId,
    doc.notes || undefined
  );
  if (result.error) {
    return { error: { code: "failed", message: result.error.message } };
  }

  return { error: null, requestedBy: pending.data.requestedBy };
}
