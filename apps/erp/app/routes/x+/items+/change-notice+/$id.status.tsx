// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  cancelPendingApprovals,
  openApprovalRequests
} from "@carbon/ee/approvals/document.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  changeNoticeNotifyStages,
  changeNoticeStatusValidator,
  updateChangeNoticeStatus
} from "~/modules/items";
import {
  applyChangeNotice,
  changeNoticeStageEvent,
  notifyChangeNoticeTransition
} from "~/modules/items/items.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "change-notice-status");

const approvalOutcomeFlash = {
  requested: success("Submitted for approval"),
  "already-pending": error(
    null,
    "This change notice is already waiting for approval"
  ),
  failed: error(null, "Failed to submit for approval")
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(changeNoticeStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { fromStatus, status: toStatus, assignee } = validation.data;

  // An approval rule gates Engineering Complete → Implementation: submitting
  // opens a request and leaves the status alone; approving it performs the
  // transition (approveRequest). Without a rule the advance proceeds as usual.
  const isGatedAdvance =
    fromStatus === "Engineering Complete" && toStatus === "Implementation";
  if (isGatedAdvance) {
    // fromStatus comes from the form: a stale page must not open a request for
    // a notice that is no longer at Engineering Complete.
    const current = await client
      .from("changeOrder")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (current.data?.status !== fromStatus) {
      throw redirect(
        requestReferrer(request) ?? path.to.changeNoticeDetails(id),
        await flash(
          request,
          error(
            current.error,
            "The change notice was updated by someone else. Refresh and try again."
          )
        )
      );
    }

    const opened = await openApprovalRequests(getCarbonServiceRole(), {
      documentType: "changeOrder",
      documentIds: [id],
      companyId,
      userId
    });

    if (opened.status === "opened" && opened.approverIds.length > 0) {
      await trigger("notify", {
        event: NotificationEvent.ApprovalRequested,
        companyId,
        documentId: id,
        documentType: "changeOrder",
        recipient: { type: "users", userIds: opened.approverIds },
        from: userId
      }).catch((e) =>
        logger.error("Failed to notify change notice approvers", {
          companyId,
          changeNoticeId: id,
          error: e
        })
      );
    }

    if (opened.status !== "not-required") {
      const outcome =
        opened.status === "failed"
          ? "failed"
          : opened.requested.length > 0
            ? "requested"
            : "already-pending";
      throw redirect(
        requestReferrer(request) ?? path.to.changeNoticeDetails(id),
        await flash(request, approvalOutcomeFlash[outcome])
      );
    }
  }

  // Implementation → Done IS the apply: applyChangeNotice activates each affected
  // item's CO-owned Draft make method and performs the final CAS flip to Done
  // (G1/G2). All other transitions go through the plain guarded status writer.
  if (toStatus === "Done") {
    const applied = await applyChangeNotice(client, getDatabaseClient(), {
      changeNoticeId: id,
      userId,
      companyId
    });
    if (applied.error || !applied.data) {
      throw redirect(
        requestReferrer(request) ?? path.to.changeNoticeDetails(id),
        await flash(
          request,
          error(applied.error, "Failed to apply change notice")
        )
      );
    }
  } else {
    const update = await updateChangeNoticeStatus(client, {
      id,
      companyId,
      fromStatus,
      toStatus,
      assignee,
      updatedBy: userId
    });

    if (update.error || !update.data) {
      throw redirect(
        requestReferrer(request) ?? path.to.changeNoticeDetails(id),
        await flash(
          request,
          error(update.error, "Failed to update change notice status")
        )
      );
    }
  }

  // Cancelling withdraws a pending request; so does a plain advance past the
  // gate, which only happens when the rule was turned off after the request
  // was opened.
  if (toStatus === "Cancelled" || isGatedAdvance) {
    const cancelled = await cancelPendingApprovals(getCarbonServiceRole(), {
      documentType: "changeOrder",
      documentIds: [id],
      companyId,
      userId
    });
    if (cancelled.error) {
      logger.error("Failed to cancel change notice approval requests", {
        companyId,
        changeNoticeId: id,
        error: cancelled.error
      });
    }
  }

  // Notify the CO assignee + action-task assignees only on the stages that
  // notify on entry (Start / Implementation / Done). Best-effort; never blocks
  // the redirect.
  if (changeNoticeNotifyStages.includes(toStatus)) {
    await notifyChangeNoticeTransition({
      client,
      event: changeNoticeStageEvent[toStatus],
      changeNoticeId: id,
      companyId,
      userId
    });
  }

  throw redirect(
    requestReferrer(request) ?? path.to.changeNoticeDetails(id),
    await flash(request, success("Updated change notice status"))
  );
}
