// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getWebhookSigningSecret } from "@carbon/ee/integrations/secrets";
import {
  SENSE_STATUS_CHANGED,
  SenseWebhookEventSchema,
  verifySenseWebhook
} from "@carbon/ee/sense/webhook";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getIntegration } from "~/modules/settings/settings.service";

// Needs node:crypto for the constant-time HMAC comparison in
// verifySenseWebhook.
export const config = { runtime: "nodejs" };

const logger = getLogger("erp", "webhook-sense");

export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.companyId) {
    return data({ success: false }, { status: 400 });
  }
  return { success: true };
}

/**
 * Receives the company's Sense webhook, registered by `ensureSenseWebhook`. A
 * `station.status_changed` delivery wakes the OEE sync of that one station,
 * which reads its events from the Sense API: the delivery is a nudge, never
 * the data, so a lost one only waits for the 10-minute sweep.
 *
 * 410 when Sense is not installed: Sense disables a webhook that answers 410
 * (`GONE`), and the next install enables it again.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  // Raw body FIRST: the signature covers the exact bytes.
  const body = await request.text();

  const serviceRole = getCarbonServiceRole();
  const integration = await getIntegration(serviceRole, "sense", companyId);
  if (integration.error) {
    logger.error("Sense webhook: integration query failed", { companyId });
    return data({ success: false }, { status: 500 });
  }
  if (!integration.data?.active) {
    return data({ success: false }, { status: 410 });
  }

  let secret: string | null;
  try {
    secret = await getWebhookSigningSecret(
      serviceRole,
      companyId,
      "sense",
      integration.data
    );
  } catch (error) {
    logger.error("Sense webhook: failed to resolve signing secret", {
      companyId,
      error
    });
    return data({ success: false }, { status: 500 });
  }

  if (
    !secret ||
    !verifySenseWebhook({
      signature: request.headers.get("sense-signature"),
      body,
      secret
    })
  ) {
    logger.warn("Sense webhook rejected", {
      companyId,
      reason: secret ? "invalid-signature" : "no-stored-secret"
    });
    return data({ success: false }, { status: 401 });
  }

  const parsed = SenseWebhookEventSchema.safeParse(safeJsonParse(body));
  if (!parsed.success) {
    logger.error("Sense webhook: invalid payload", { companyId });
    return data({ success: false }, { status: 400 });
  }
  const event = parsed.data;
  if (event.test || event.type !== SENSE_STATUS_CHANGED || !event.data) {
    return { success: true };
  }

  // Only a mapped station has a sync to wake.
  const device = await serviceRole
    .from("workCenterDevice")
    .select("id")
    .eq("companyId", companyId)
    .eq("integration", "sense")
    .eq("externalDeviceId", event.data.device_id)
    .maybeSingle();
  if (device.error) {
    logger.error("Sense webhook: device query failed", { companyId });
    return data({ success: false }, { status: 500 });
  }
  if (!device.data) return { success: true };

  await trigger("oee-device-sync", {
    companyId,
    integrationId: "sense",
    externalDeviceId: event.data.device_id
  });

  return { success: true };
}

function safeJsonParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
