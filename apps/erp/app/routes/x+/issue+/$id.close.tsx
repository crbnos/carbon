import { assertIsPost, ERP_URL, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { notifyIssueStatusChanged } from "@carbon/ee/notifications";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { closeIssue } from "~/modules/quality/quality-disposition.server";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "id-close");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceRole = await getCarbonServiceRole();
  const result = await closeIssue(serviceRole, {
    nonConformanceId: id,
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.issueDetails(id),
      await flash(
        request,
        error(result.error, result.error.message ?? "Failed to close NCR")
      )
    );
  }

  try {
    const integrations = await getCompanyIntegrations(client, companyId);
    await notifyIssueStatusChanged({ client }, integrations, {
      companyId,
      userId,
      carbonUrl: `${ERP_URL}${path.to.issue(id)}`,
      issue: {
        id,
        status: "Closed",
        nonConformanceId: id,
        title: ""
      }
    });
  } catch (err) {
    logger.error("Failed to send close notifications", { error: err });
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issueDetails(id),
    await flash(request, success("NCR closed"))
  );
}
