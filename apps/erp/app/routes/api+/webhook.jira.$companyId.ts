import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { syncIssueFromJiraSchema, trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getIntegration } from "../../modules/settings";

const logger = getLogger("erp", "webhook-jira-companyid");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return {
    success: true
  };
}
export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;

  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  const serviceRole = getCarbonServiceRole();

  const integration = await getIntegration(serviceRole, "jira", companyId);

  if (integration.error) {
    return data(
      { success: false, error: "Integration query failed" },
      { status: 400 }
    );
  }

  if (!integration.data) {
    return data(
      { success: false, error: "Integration not configured" },
      { status: 400 }
    );
  }

  if (!integration.data.active) {
    return data(
      { success: false, error: "Integration not active" },
      { status: 400 }
    );
  }

  const body = await request.json();

  const parsed = syncIssueFromJiraSchema.safeParse({
    companyId,
    event: body
  });

  if (!parsed.success) {
    return data(
      { success: false, error: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    await trigger("sync-issue-from-jira", parsed.data);
    return { success: true };
  } catch (err) {
    logger.error("Error", { error: err });
    return data({ success: false }, { status: 500 });
  }
}
