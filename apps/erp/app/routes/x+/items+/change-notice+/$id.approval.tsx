// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import { decideApprovalRequest } from "@carbon/ee/approvals/document.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  changeNoticeStageEvent,
  notifyChangeNoticeTransition
} from "~/modules/items/items.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "change-notice-approval");

// Approving performs Engineering Complete → Implementation inside
// approveRequest's transaction; rejecting leaves the status alone.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(approvalDecisionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { approvalRequestId, decision, notes } = validation.data;
  const result = await decideApprovalRequest(
    getCarbonServiceRole(),
    getDatabaseClient(),
    {
      documentType: "changeOrder",
      documentId: id,
      companyId,
      userId,
      approvalRequestId,
      decision,
      notes
    }
  );

  if (result.error) {
    logger.error("Change notice approval decision failed", {
      companyId,
      changeNoticeId: id,
      approvalRequestId,
      error: result.error
    });
    throw redirect(
      path.to.changeNoticeDetails(id),
      await flash(request, error(result.error, result.error.message))
    );
  }

  if (result.requestedBy !== userId) {
    await trigger("notify", {
      event:
        decision === "Approved"
          ? NotificationEvent.ApprovalApproved
          : NotificationEvent.ApprovalRejected,
      companyId,
      documentId: id,
      documentType: "changeOrder",
      recipient: { type: "user", userId: result.requestedBy },
      from: userId
    }).catch((e) =>
      logger.error("Failed to notify the approval requester", {
        companyId,
        changeNoticeId: id,
        error: e
      })
    );
  }

  // The notice just entered Implementation: notify the same people a plain
  // advance would.
  if (decision === "Approved") {
    await notifyChangeNoticeTransition({
      client,
      event: changeNoticeStageEvent.Implementation,
      changeNoticeId: id,
      companyId,
      userId
    });
  }

  throw redirect(
    path.to.changeNoticeDetails(id),
    await flash(
      request,
      success(`Approval request ${decision.toLowerCase()} successfully`)
    )
  );
}
