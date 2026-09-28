import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getWebhookSigningSecret } from "@carbon/ee/integrations/secrets";
import { verifyLinearWebhook } from "@carbon/ee/linear.server";
import { syncIssueFromLinearSchema, trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getIntegration } from "~/modules/settings/settings.service";

// Needs node:crypto for the constant-time HMAC comparison in
// verifyLinearWebhook.
export const config = { runtime: "nodejs" };

const logger = getLogger("erp", "webhook-linear-companyid");

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
 * Receives the webhook a customer creates BY HAND in Linear (see the setup
 * instructions in `@carbon/ee` `linear/config.tsx`). Signing is OPT-IN so
 * installs made before it existed keep working: with a "Webhook Signing
 * Secret" saved on the integration, every delivery must carry a valid
 * `Linear-Signature` and a fresh `webhookTimestamp`; without one, deliveries
 * are accepted as before and logged as unsigned.
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
  const integration = await getIntegration(serviceRole, "linear", companyId);

  if (integration.error) {
    logger.error("Linear webhook: integration query failed", {
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
      "linear",
      integration.data
    );
  } catch (error) {
    logger.error("Linear webhook: failed to resolve signing secret", {
      companyId,
      error
    });
    return data({ success: false }, { status: 500 });
  }

  if (signingSecret) {
    const verification = verifyLinearWebhook({
      signature: request.headers.get("linear-signature"),
      body,
      secret: signingSecret
    });
    if (!verification.ok) {
      logger.warning("Linear webhook rejected", {
        companyId,
        reason: verification.reason
      });
      return data({ success: false }, { status: 401 });
    }
  } else {
    logger.warning(
      "Linear webhook is unsigned: add the webhook's signing secret to the Linear integration settings to verify deliveries",
      { companyId }
    );
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return data({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = syncIssueFromLinearSchema.safeParse({
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
    await trigger("sync-issue-from-linear", parsed.data);
    return { success: true };
  } catch (err) {
    logger.error("Linear webhook: failed to trigger task", {
      companyId,
      error: err
    });
    return data({ success: false }, { status: 500 });
  }
}
