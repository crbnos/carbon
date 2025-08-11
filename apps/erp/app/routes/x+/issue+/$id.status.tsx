import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { syncIssueStatusToSlack } from "@carbon/integrations/slack.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  getIssue,
  nonConformanceStatus,
  updateIssueStatus,
} from "~/modules/quality";
import { hasSlackIntegration } from "~/modules/settings/settings.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof nonConformanceStatus)[number];

  if (!status || !nonConformanceStatus.includes(status)) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const currentIssue = await getIssue(client, id);
  const previousStatus = currentIssue.data?.status || "";

  const [update] = await Promise.all([
    updateIssueStatus(client, {
      id,
      status,
      assignee: ["Closed"].includes(status) ? null : undefined,
      closeDate: ["Closed"].includes(status) ? new Date().toISOString() : null,
      updatedBy: userId,
    }),
  ]);
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(request, error(update.error, "Failed to update issue status"))
    );
  }

  // Sync status update to Slack (non-blocking)
  try {
    const hasSlack = await hasSlackIntegration(client, companyId);
    if (hasSlack) {
      await syncIssueStatusToSlack(client, {
        nonConformanceId: id,
        companyId,
        previousStatus,
        newStatus: status,
        updatedBy: userId,
        reason: formData.get("reason") as string | undefined,
      });
    }
  } catch (error) {
    console.error("Failed to sync status to Slack:", error);
    // Continue without blocking the main operation
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issueDetails(id),
    await flash(request, success("Updated issue status"))
  );
}
