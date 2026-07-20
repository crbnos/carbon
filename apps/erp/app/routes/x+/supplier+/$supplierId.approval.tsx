import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { supplierApprovalDecisionValidator } from "~/modules/purchasing";
import {
  approveRequest,
  canApproveRequest,
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  getLatestApprovalRequestForDocument,
  hasPendingApproval,
  rejectRequest
} from "~/modules/shared";
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

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "request-approval") {
    const serviceRole = getCarbonServiceRole();

    const pending = await hasPendingApproval(
      serviceRole,
      "supplier",
      supplierId
    );

    if (pending) {
      throw redirect(
        path.to.supplier(supplierId),
        await flash(
          request,
          error(null, "An approval request already exists for this supplier")
        )
      );
    }

    await createApprovalRequest(serviceRole, {
      documentType: "supplier",
      documentId: supplierId,
      companyId,
      requestedBy: userId,
      createdBy: userId,
      amount: undefined
    });

    // Update supplier status to Pending
    await client
      .from("supplier")
      .update({
        supplierStatus: "Pending",
        updatedBy: userId,
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", supplierId);

    const rule = await getApprovalRuleByAmount(
      serviceRole,
      "supplier",
      companyId,
      undefined
    );
    const approverIds = rule.data
      ? await getApproverUserIdsForRule(serviceRole, rule.data)
      : [];

    if (approverIds.length > 0) {
      try {
        await trigger("notify", {
          event: NotificationEvent.ApprovalRequested,
          companyId,
          documentId: supplierId,
          documentType: "supplier",
          recipient: { type: "users", userIds: approverIds },
          from: userId
        });
      } catch (e) {
        logger.error("Failed to trigger approval notification", { error: e });
      }
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
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", supplierId);

    throw redirect(
      path.to.supplier(supplierId),
      await flash(request, success("Supplier deactivated"))
    );
  }

  // Handle approve/reject intents
  const validation = await validator(
    supplierApprovalDecisionValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { approvalRequestId, decision, notes } = validation.data;

  const serviceRole = getCarbonServiceRole();

  const approvalRequest = await getLatestApprovalRequestForDocument(
    serviceRole,
    "supplier",
    supplierId
  );

  if (!approvalRequest.data || approvalRequest.data.id !== approvalRequestId) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(request, error(null, "Approval request not found"))
    );
  }

  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: approvalRequest.data.amount,
      documentType: approvalRequest.data.documentType,
      companyId: approvalRequest.data.companyId
    },
    userId
  );

  if (!canApprove) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(null, "You do not have permission to approve this request")
      )
    );
  }

  const db = getDatabaseClient();
  const result =
    decision === "Approved"
      ? await approveRequest(db, approvalRequestId, userId, notes || undefined)
      : await rejectRequest(db, approvalRequestId, userId, notes || undefined);

  if (result.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(
          result.error,
          result.error?.message ?? "Failed to process approval decision"
        )
      )
    );
  }

  const requestedBy = approvalRequest.data?.requestedBy;
  const requestCompanyId = approvalRequest.data?.companyId;
  if (requestedBy && requestCompanyId && requestedBy !== userId) {
    try {
      await trigger("notify", {
        event:
          decision === "Approved"
            ? NotificationEvent.ApprovalApproved
            : NotificationEvent.ApprovalRejected,
        companyId: requestCompanyId,
        documentId: supplierId,
        documentType: "supplier",
        recipient: { type: "user", userId: requestedBy },
        from: userId
      });
    } catch (e) {
      logger.error("Failed to trigger approval decision notification", {
        error: e
      });
    }
  }

  throw redirect(
    path.to.supplier(supplierId),
    await flash(
      request,
      success(`Approval request ${decision.toLowerCase()} successfully`)
    )
  );
}
