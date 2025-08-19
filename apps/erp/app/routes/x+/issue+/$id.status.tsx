import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { notifyIssueStatusChanged } from "@carbon/integrations/notifications";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { nonConformanceStatus, updateIssueStatus } from "~/modules/quality";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
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

  // Send status update notifications (non-blocking)
  try {
    const integrations = await getCompanyIntegrations(client, companyId);
    await notifyIssueStatusChanged({ client }, integrations, {
      companyId,
      userId,
      carbonUrl: `https://app.carbon.ms${path.to.issue(id)}`, // We might need the full URL here
      issue: {
        id,
        status,
        nonConformanceId: id,
        title: "", // We might need to get the title from the issue data
      },
    });
  } catch (error) {
    console.error("Failed to send notifications:", error);
    // Continue without blocking the main operation
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issueDetails(id),
    await flash(request, success("Updated issue status"))
  );
}
