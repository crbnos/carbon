// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

  // Diagnostics: every refusal logs why, with Linear's delivery id and event
  // headers, and says why in the body (Linear shows it in the webhook's
  // delivery log). The 401 stays bare: a signature failure explains nothing.
  const delivery = {
    companyId,
    deliveryId: request.headers.get("linear-delivery"),
    event: request.headers.get("linear-event")
  };
  const reject = (reason: string, details?: Record<string, unknown>) => {
    logger.warning("Linear webhook: 400", { ...delivery, reason, ...details });
    return data({ success: false, reason, ...details }, { status: 400 });
  };

  if (!companyId) {
    return reject("No company id in the webhook URL");
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
    return reject("Integration query failed");
  }

  if (!integration.data) {
    return reject(
      "Linear is not installed for this company: check the company id in the webhook URL"
    );
  }

  if (!integration.data.active) {
    return reject("The Linear integration is not active for this company");
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
    return reject("The body is not JSON", { bodyLength: body.length });
  }

  // Linear sends every event type the webhook subscribes to (comments,
  // labels, the attachment our own link creates, issue creates). Only an
  // issue update or remove syncs; the rest get a 200 and are ignored, since
  // Linear disables a webhook that keeps failing.
  const envelope = event as { type?: unknown; action?: unknown } | null;
  if (
    envelope?.type !== "Issue" ||
    (envelope.action !== "update" && envelope.action !== "remove")
  ) {
    logger.info("Linear webhook: ignored", {
      ...delivery,
      type: envelope?.type,
      action: envelope?.action
    });
    return { success: true, ignored: true };
  }

  const parsed = syncIssueFromLinearSchema.safeParse({
    companyId,
    event
  });

  if (!parsed.success) {
    const payload = event as { data?: Record<string, unknown> };
    return reject("The issue payload does not match the expected shape", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      })),
      dataKeys: Object.keys(payload?.data ?? {})
    });
  }

  logger.info("Linear webhook: accepted", {
    ...delivery,
    action: parsed.data.event.action,
    issueId: parsed.data.event.data.id
  });

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
