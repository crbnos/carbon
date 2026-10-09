// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  approveRequest,
  canApproveRequest,
  cancelApprovalRequest,
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  getLatestApprovalRequestForDocument,
  isApprovalRequired,
  rejectRequest
} from "@carbon/ee/approvals.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  getProjectChangeRequest,
  projectChangeRequestIntentFrom,
  projectChangeRequestStatusValidator
} from "~/modules/projects";
import {
  applyChangeRequest,
  ProjectChangeConflictError,
  ProjectChangeRequestError,
  reopenChangeRequest,
  setChangeRequestStatus
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-change-request-status");

/**
 * Moves a change request through its lifecycle. `intent` picks the step:
 * - `submit` (Draft → In Review) opens an approval request when a rule
 *   applies and notifies its approvers;
 * - `approve` and `reject` decide through the approval request when one is
 *   pending, else directly (a user with `update: projects`); an approval then
 *   applies the change request;
 * - `cancel` (Draft or In Review → Cancelled);
 * - `reopen` (Rejected, or Approved after a conflict → Draft).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId, crId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!crId) throw new Error("Could not find crId");

  const back = path.to.projectChangeRequest(projectId, crId);
  const refuse = async (err: unknown, message: string) =>
    redirect(back, await flash(request, error(err, message)));
  const done = async (message: string) =>
    redirect(back, await flash(request, success(message)));

  const form = projectChangeRequestStatusValidator.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!form.success) throw await refuse(null, "Unknown action");
  const { intent, notes } = form.data;

  const changeRequest = await getProjectChangeRequest(client, crId, companyId);
  if (changeRequest.error || changeRequest.data.projectId !== projectId) {
    throw await refuse(
      changeRequest.error,
      "The change request does not exist"
    );
  }
  const { status, readableId } = changeRequest.data;
  if (!projectChangeRequestIntentFrom[intent].includes(status)) {
    throw await refuse(null, `A ${status} change request cannot ${intent}`);
  }

  const db = getDatabaseClient();
  const serviceRole = getCarbonServiceRole();
  const scope = { companyId, userId, projectId, changeRequestId: crId };
  // The notification carries the project too, so its link can open the page.
  const notificationDocumentId = `${projectId}:${crId}`;

  // The pending approval request of this change request, proven to be this
  // company's: the service role reads it by a URL id.
  const pendingApproval = async () => {
    const latest = await getLatestApprovalRequestForDocument(
      serviceRole,
      "projectChangeRequest",
      crId
    );
    return latest.data && latest.data.companyId === companyId
      ? latest.data
      : null;
  };

  const notifyRequester = async (
    approval: { requestedBy: string | null },
    approved: boolean
  ) => {
    if (!approval.requestedBy || approval.requestedBy === userId) return;
    try {
      await trigger("notify", {
        event: approved
          ? NotificationEvent.ApprovalApproved
          : NotificationEvent.ApprovalRejected,
        companyId,
        documentId: notificationDocumentId,
        documentType: "projectChangeRequest",
        recipient: { type: "user", userId: approval.requestedBy },
        from: userId
      });
    } catch (e) {
      logger.error("Failed to trigger approval decision notification", {
        error: e
      });
    }
  };

  // Applies an Approved change request. A conflict keeps it Approved and
  // lists the rows the live plan changed; the author reopens it to fix them.
  const apply = async () => {
    let applied = false;
    try {
      ({ applied } = await applyChangeRequest(db, {
        companyId,
        userId,
        changeRequestId: crId
      }));
    } catch (err) {
      if (err instanceof ProjectChangeConflictError) {
        throw await refuse(
          null,
          `${readableId} is approved but cannot apply: the live plan changed under ${err.conflicts.length} of its rows. Reopen it to fix them.`
        );
      }
      logger.error("Failed to apply a change request", {
        companyId,
        projectId,
        changeRequestId: crId,
        error: err
      });
      throw await refuse(
        err,
        err instanceof ProjectChangeRequestError
          ? `${readableId} is approved but cannot apply: ${err.message}`
          : `${readableId} is approved but failed to apply`
      );
    }
    throw await done(
      applied ? `${readableId} applied` : `${readableId} approved`
    );
  };

  switch (intent) {
    case "submit": {
      const items = await client
        .from("projectChangeRequestItem")
        .select("id", { count: "exact", head: true })
        .eq("changeRequestId", crId)
        .eq("companyId", companyId);
      if (items.error) throw await refuse(items.error, "Failed to submit");
      if ((items.count ?? 0) === 0) {
        throw await refuse(null, "Change the plan before you submit");
      }

      if (
        await isApprovalRequired(serviceRole, "projectChangeRequest", companyId)
      ) {
        if (!(await pendingApproval())) {
          const created = await createApprovalRequest(serviceRole, {
            documentType: "projectChangeRequest",
            documentId: crId,
            companyId,
            requestedBy: userId,
            createdBy: userId
          });
          if (created.error) {
            throw await refuse(created.error, "Failed to request approval");
          }
          const rule = await getApprovalRuleByAmount(
            serviceRole,
            "projectChangeRequest",
            companyId
          );
          const approverIds = rule.data
            ? await getApproverUserIdsForRule(serviceRole, rule.data)
            : [];
          if (approverIds.length > 0) {
            try {
              await trigger("notify", {
                event: NotificationEvent.ApprovalRequested,
                companyId,
                documentId: notificationDocumentId,
                documentType: "projectChangeRequest",
                recipient: { type: "users", userIds: approverIds },
                from: userId
              });
            } catch (e) {
              logger.error("Failed to trigger approval notification", {
                error: e
              });
            }
          }
        }
      }

      const moved = await setChangeRequestStatus(db, {
        ...scope,
        from: ["Draft"],
        to: "In Review",
        set: { submittedAt: true }
      });
      if (!moved) throw await refuse(null, "Failed to submit");
      throw await done(`${readableId} submitted for review`);
    }

    case "approve":
    case "reject": {
      const approved = intent === "approve";
      const approval = await pendingApproval();
      if (approval?.id) {
        const canApprove = await canApproveRequest(
          serviceRole,
          {
            amount: approval.amount,
            documentType: approval.documentType,
            companyId: approval.companyId
          },
          userId
        );
        if (!canApprove) {
          throw await refuse(
            null,
            "You do not have permission to approve this request"
          );
        }
        // The approvals engine moves the change request to Approved or
        // Rejected in its own transaction. A cancel by anyone but the
        // requester is refused there too.
        const result = approved
          ? await approveRequest(db, approval.id, userId, notes || undefined)
          : await rejectRequest(db, approval.id, userId, notes || undefined);
        if (result.error) {
          throw await refuse(
            result.error,
            result.error.message ?? "Failed to record the decision"
          );
        }
        await notifyRequester(approval, approved);
      } else {
        // No approval rule applies: a user with `update: projects` decides.
        const moved = await setChangeRequestStatus(db, {
          ...scope,
          from: ["In Review"],
          to: approved ? "Approved" : "Rejected",
          set: { decided: true, decisionNotes: notes ?? null }
        });
        if (!moved) throw await refuse(null, "Failed to record the decision");
      }
      if (!approved) throw await done(`${readableId} rejected`);
      return apply();
    }

    case "cancel": {
      const approval = await pendingApproval();
      if (approval?.id) {
        const cancelled = await cancelApprovalRequest(
          serviceRole,
          approval.id,
          userId
        );
        if (cancelled.error) {
          throw await refuse(cancelled.error, cancelled.error.message);
        }
      }
      const moved = await setChangeRequestStatus(db, {
        ...scope,
        from: ["Draft", "In Review"],
        to: "Cancelled"
      });
      if (!moved) throw await refuse(null, "Failed to cancel");
      throw await done(`${readableId} cancelled`);
    }

    case "reopen": {
      try {
        const { dropped } = await reopenChangeRequest(db, scope);
        throw await done(
          dropped > 0
            ? `${readableId} reopened. ${dropped} change(s) no longer fit the live plan and were removed.`
            : `${readableId} reopened`
        );
      } catch (err) {
        if (err instanceof Response) throw err;
        logger.error("Failed to reopen a change request", {
          companyId,
          projectId,
          changeRequestId: crId,
          error: err
        });
        throw await refuse(
          err,
          err instanceof Error ? err.message : "Failed to reopen"
        );
      }
    }
  }
}
