import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getWebhookSigningSecret } from "@carbon/ee/integrations/secrets";
import { verifyJiraWebhook } from "@carbon/ee/jira.server";
import { syncIssueFromJiraSchema, trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getIntegration } from "~/modules/settings/settings.service";

// Needs node:crypto for the constant-time HMAC comparison in
// verifyJiraWebhook.
export const config = { runtime: "nodejs" };

const logger = getLogger("erp", "webhook-jira-companyid");

export async function loader({ params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return {
    success: true
  };
}

/**
 * Receives the admin webhook a customer creates BY HAND in Jira (see the setup
 * instructions in `@carbon/ee` `jira/config.tsx`). Signing is OPT-IN so
 * installs made before it existed keep working: with a "Webhook Secret" saved
 * on the integration, every delivery must carry a valid `X-Hub-Signature`;
 * without one, deliveries are accepted as before and logged as unsigned.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;

  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  // Raw body FIRST — the signature covers the exact bytes, not re-serialized
  // JSON.
  const body = await request.text();

  const serviceRole = getCarbonServiceRole();

  const integration = await getIntegration(serviceRole, "jira", companyId);

  if (integration.error) {
    logger.error("Jira webhook: integration query failed", {
      companyId,
      error: integration.error
    });
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

  // Fail closed when the vault is unreadable: "no secret configured" cannot be
  // told apart from "secret unavailable", and only the former may skip the
  // signature check.
  let signingSecret: string | null;
  try {
    signingSecret = await getWebhookSigningSecret(
      serviceRole,
      companyId,
      "jira",
      integration.data
    );
  } catch (error) {
    logger.error("Jira webhook: failed to resolve signing secret", {
      companyId,
      error
    });
    return data({ success: false }, { status: 500 });
  }

  if (signingSecret) {
    const verification = verifyJiraWebhook({
      signature: request.headers.get("x-hub-signature"),
      body,
      secret: signingSecret
    });
    if (!verification.ok) {
      logger.warning("Jira webhook rejected", {
        companyId,
        reason: verification.reason
      });
      return data({ success: false }, { status: 401 });
    }
  } else {
    logger.warning(
      "Jira webhook is unsigned: add the webhook's secret to the Jira integration settings to verify deliveries",
      { companyId }
    );
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return data({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = syncIssueFromJiraSchema.safeParse({
    companyId,
    event
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
    logger.error("Jira webhook: failed to trigger task", {
      companyId,
      error: err
    });
    return data({ success: false }, { status: 500 });
  }
}
