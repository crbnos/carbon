import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { notifyTaskStatusChanged } from "@carbon/ee/notifications";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import type { IssueInvestigationTask } from "~/modules/quality";
import { updateIssueTaskStatus } from "~/modules/quality";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

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
    const integrations = await getCompanyIntegrations(client, companyId);
    if (update.data?.nonConformanceId) {
      await notifyTaskStatusChanged({ client }, integrations, {
        companyId,
        userId,
        carbonUrl: `https://app.carbon.ms${path.to.issue(
          update.data.nonConformanceId
        )}`,
        task: {
          id,
          status,
          issueId: update.data.nonConformanceId,
          title: "",
          type,
        },
      });
    }
  } catch (error) {
    console.error("Failed to sync task to Slack:", error);
    // Continue without blocking the main operation
  }

  return json({});
}
