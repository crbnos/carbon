// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import {
  decideApprovalRequest,
  openApprovalRequests
} from "@carbon/ee/approvals/document.server";
import { canApproveRequest } from "@carbon/ee/approvals.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { datetime, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "supplierid-approval");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  // Approval requests, their lookups and the approve/reject status writes all
  // go through the service role (or Kysely) keyed on the URL's supplierId.
  await requireCompanyRecord(getCarbonServiceRole(), "supplier", companyId, {
    id: supplierId
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "request-approval") {
    const opened = await openApprovalRequests(getCarbonServiceRole(), {
      documentType: "supplier",
      documentIds: [supplierId],
      companyId,
      userId
    });

    if (opened.status !== "opened" || opened.requested.length === 0) {
      throw redirect(
        path.to.supplier(supplierId),
        await flash(
          request,
          error(
            null,
            opened.status === "opened"
              ? "An approval request already exists for this supplier"
              : opened.status === "not-required"
                ? "Suppliers do not require approval"
                : "Failed to submit for approval"
          )
        )
      );
    }

    await client
      .from("supplier")
      .update({
        supplierStatus: "Pending",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", supplierId);

    if (opened.approverIds.length > 0) {
      await trigger("notify", {
        event: NotificationEvent.ApprovalRequested,
        companyId,
        documentId: supplierId,
        documentType: "supplier",
        recipient: { type: "users", userIds: opened.approverIds },
        from: userId
      }).catch((e) =>
        logger.error("Failed to trigger approval notification", { error: e })
      );
    }

    throw redirect(
      path.to.supplier(supplierId),
      await flash(request, success("Approval request submitted"))
    );
  }

  if (intent === "make-inactive") {
    const serviceRole = getCarbonServiceRole();

    const canApprove = await canApproveRequest(
      serviceRole,
      {
        amount: null,
        documentType: "supplier",
        companyId
      },
      userId
    );

    if (!canApprove) {
      throw redirect(
        path.to.supplier(supplierId),
        await flash(
          request,
          error(null, "You do not have permission to deactivate this supplier")
        )
      );
    }

    await client
      .from("supplier")
      .update({
        supplierStatus: "Inactive",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", supplierId);

    throw redirect(
      path.to.supplier(supplierId),
      await flash(request, success("Supplier deactivated"))
    );
  }

  // Handle approve/reject intents
  const validation = await validator(approvalDecisionValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { approvalRequestId, decision, notes } = validation.data;
  const result = await decideApprovalRequest(
    getCarbonServiceRole(),
    getDatabaseClient(),
    {
      documentType: "supplier",
      documentId: supplierId,
      companyId,
      userId,
      approvalRequestId,
      decision,
      notes
    }
  );

  if (result.error) {
    logger.error("Supplier approval decision failed", {
      companyId,
      supplierId,
      approvalRequestId,
      error: result.error
    });
    throw redirect(
      path.to.supplier(supplierId),
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
      documentId: supplierId,
      documentType: "supplier",
      recipient: { type: "user", userId: result.requestedBy },
      from: userId
    }).catch((e) =>
      logger.error("Failed to trigger approval decision notification", {
        error: e
      })
    );
  }

  throw redirect(
    path.to.supplier(supplierId),
    await flash(
      request,
      success(`Approval request ${decision.toLowerCase()} successfully`)
    )
  );
}
