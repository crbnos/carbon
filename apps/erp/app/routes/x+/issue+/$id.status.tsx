import { assertIsPost, ERP_URL, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { notifyIssueStatusChanged } from "@carbon/ee/notifications";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { nonConformanceStatus, updateIssueStatus } from "~/modules/quality";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "id-status");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof nonConformanceStatus)[number];

  if (!status || !nonConformanceStatus.includes(status)) {
    throw redirect(
      requestReferrer(request) ?? path.to.issueDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // Block reopening an NCR whose disposition already posted inventory value.
  // Reversing posted GL must be an explicit compensating action (SAP-aligned),
  // not a casual reopen. Narrow: only NCRs that actually posted a ledger movement
  // are blocked (an all-Use-As-Is/tracked NCR posts nothing and stays reopenable).
  // Read via service role — itemLedger SELECT needs inventory/accounting_view,
  // which a quality user may lack, so a user-client read would fail open.
  if (status !== "Closed") {
    const serviceRole = getCarbonServiceRole();
    const current = await serviceRole
      .from("nonConformance")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (current.data?.status === "Closed") {
      const posted = await serviceRole
        .from("itemLedger")
        .select("id")
        .eq("documentType", "Non-Conformance")
        .eq("documentId", id)
        .eq("companyId", companyId)
        .limit(1);
      if ((posted.data?.length ?? 0) > 0) {
        throw redirect(
          requestReferrer(request) ?? path.to.issueDetails(id),
          await flash(
            request,
            error(
              null,
              "This NCR posted inventory transactions and can't be reopened. Create a correcting entry instead."
            )
          )
        );
      }
    }
  }

  const update = await updateIssueStatus(client, {
    id,
    status,
    assignee: ["Closed"].includes(status) ? null : undefined,
    closeDate: ["Closed"].includes(status) ? new Date().toISOString() : null,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.issueDetails(id),
      await flash(request, error(update.error, "Failed to update issue status"))
    );
  }

  // Send status update notifications (non-blocking)
  try {
    const integrations = await getCompanyIntegrations(client, companyId);
    await notifyIssueStatusChanged({ client }, integrations, {
      companyId,
      userId,
      carbonUrl: `${ERP_URL}${path.to.issue(id)}`, // We might need the full URL here
      issue: {
        id,
        status,
        nonConformanceId: id,
        title: "" // We might need to get the title from the issue data
      }
    });
  } catch (error) {
    logger.error("Failed to send notifications", { error: error });
    // Continue without blocking the main operation
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issueDetails(id),
    await flash(request, success("Updated issue status"))
  );
}
