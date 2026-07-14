import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { syncIssueFromLinearSchema, trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getIntegration } from "../../modules/settings";

const logger = getLogger("erp", "webhook-linear-companyid");

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
  const integration = await getIntegration(serviceRole, "linear", companyId);

  if (integration.error) {
    logger.error("Linear webhook: integration query failed", integration.error);
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

  const parsed = syncIssueFromLinearSchema.safeParse({
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
    await trigger("sync-issue-from-linear", parsed.data);
    return { success: true };
  } catch (err) {
    logger.error("Linear webhook: failed to trigger task", { error: err });
    return data({ success: false }, { status: 500 });
  }
}
