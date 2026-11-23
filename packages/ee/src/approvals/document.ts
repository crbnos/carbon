// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ApprovalStatus, DocumentApprovalState } from "./types";

// Pure decisions behind `document.server.ts`, testable without a database.

type LatestRequest = {
  id: string;
  status: ApprovalStatus;
  requestedBy: string;
  decisionBy: string | null;
  decisionNotes: string | null;
  decisionAt: string | null;
} | null;

/**
 * A document's approval controls, from its latest NON-cancelled request: only
 * one request can be pending and it is always the newest, so that request is
 * either the pending one or the last decision.
 */
export function toDocumentApprovalState(
  request: LatestRequest,
  access: { isRequired: boolean; canApprove: boolean }
): DocumentApprovalState {
  const isPending = request?.status === "Pending";
  return {
    pendingRequestId: isPending ? request.id : null,
    pendingRequestedBy: isPending ? request.requestedBy : null,
    canApprove: access.canApprove,
    isRequired: access.isRequired,
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

export type WithdrawalVerdict =
  | { error: null }
  | { error: { code: "forbidden" | "failed"; message: string } };

/**
 * Whether a user may withdraw pending requests: they asked for every one of
 * them, or they can decide them. A failed read of the requests cannot tell
 * whose they are, so it refuses.
 */
export function withdrawalVerdict(
  pending: {
    data: { requestedBy: string }[] | null;
    error: { message: string } | null;
  },
  userId: string,
  canApprove: boolean
): WithdrawalVerdict {
  if (pending.error || !pending.data) {
    return {
      error: {
        code: "failed",
        message: pending.error?.message ?? "Failed to read approval requests"
      }
    };
  }
  const othersRequests = pending.data.some((r) => r.requestedBy !== userId);
  if (othersRequests && !canApprove) {
    return {
      error: {
        code: "forbidden",
        message:
          "Only the requester or an approver can withdraw a pending approval request"
      }
    };
  }
  return { error: null };
}
