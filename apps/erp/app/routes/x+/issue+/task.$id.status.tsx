import { json, type ActionFunctionArgs } from "@vercel/remix";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { syncIssueTaskToSlack } from "@carbon/integrations/slack.server";
import type { IssueInvestigationTask } from "~/modules/quality";
import { updateIssueTaskStatus } from "~/modules/quality";
import { hasSlackIntegration } from "~/modules/settings/settings.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality",
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  if (id !== params.id) {
    return json(
      {},
      await flash(request, error("Invalid task ID", "Invalid task ID"))
    );
  }
  const status = formData.get("status") as IssueInvestigationTask["status"];
  const type = formData.get("type") as
    | "investigation"
    | "action"
    | "approval"
    | "review";
  const assignee = formData.get("assignee") as string;

  const update = await updateIssueTaskStatus(client, {
    id,
    status,
    type,
    assignee,
    userId,
  });
  if (update.error) {
    return json(
      {},
      await flash(request, error(update.error, "Failed to update status"))
    );
  }

  try {
    const hasSlack = await hasSlackIntegration(client, companyId);
    if (hasSlack && update.data?.nonConformanceId) {
      await syncIssueTaskToSlack(client, {
        completedAt:
          status === "Completed" ? new Date().toISOString() : undefined,
        companyId,
        id,
        nonConformanceId: update.data.nonConformanceId,
        status,
        taskType: type as "investigation" | "action" | "approval",
        userId,
      });
    }
  } catch (error) {
    console.error("Failed to sync task to Slack:", error);
    // Continue without blocking the main operation
  }

  return json({});
}
