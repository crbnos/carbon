// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getAppUrl } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { KyselyDatabase } from "@carbon/database/client";
import { getPostgresClient, getProcessPool } from "@carbon/database/client";
import {
  endSensorMachineTime,
  lockWorkCenterDevice
} from "@carbon/database/machine-time";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { PostgresDriver } from "kysely";
import {
  patchIntegrationState,
  resolveIntegrationSecrets,
  WEBHOOK_SIGNING_SECRET_KEY
} from "../integrations/secrets";
import { postEndedMachineEvents } from "../oee/service.server";
import type { IntegrationHealthcheckResult } from "../types";
import { createSenseProvider } from "./provider";
import { senseWebhookUrl } from "./webhook";

const SENSE = "sense";

const logger = getLogger("ee", "sense");

function senseFromMetadata(metadata: Record<string, unknown>) {
  const apiKey = typeof metadata.apiKey === "string" ? metadata.apiKey : "";
  if (!apiKey) throw new Error("No API key");
  return createSenseProvider({
    apiKey,
    environment: String(metadata.environment ?? "production")
  });
}

/**
 * Sense only delivers to HTTPS, so a local origin gets no webhook and runs on
 * the sweep alone.
 */
function webhookOrigin(): string | null {
  const origin = getAppUrl();
  return origin.startsWith("https://") ? origin : null;
}

/** `metadata` arrives with the vaulted secrets already resolved. */
export async function senseHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
): Promise<IntegrationHealthcheckResult> {
  try {
    const provider = senseFromMetadata(metadata);
    const { valid, error } = await provider.validate();
    if (!valid) return { healthy: false, reason: error };

    const origin = webhookOrigin();
    if (!origin) return { healthy: true };
    const webhook = await provider.getWebhook();
    const problem = !webhook
      ? "Sense has no webhook for Carbon"
      : webhook.url !== senseWebhookUrl(origin, companyId)
        ? "The Sense webhook sends events somewhere else"
        : !webhook.enabled
          ? `Sense disabled the webhook (${webhook.disabled_reason ?? "unknown reason"})`
          : !metadata[WEBHOOK_SIGNING_SECRET_KEY]
            ? "Carbon has no signing secret for the Sense webhook"
            : null;
    return problem
      ? {
          healthy: false,
          reason: `${problem}, so machine time updates only every 10 minutes. Save the settings to fix it.`
        }
      : { healthy: true };
  } catch (error) {
    return {
      healthy: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Points the company's Sense webhook (it has at most one) at Carbon, with no
 * filters, and enables it. The signing secret is rotated and vaulted unless
 * the webhook already pointed here, was enabled and Carbon holds its secret:
 * a webhook created elsewhere has a secret only its creator knows. Runs on
 * install and on every settings save, so a save repairs a webhook Sense
 * disabled. An uninstalled company answers 410 to deliveries, which disables
 * the webhook at Sense until the next install enables it again.
 */
export async function ensureSenseWebhook(companyId: string) {
  const origin = webhookOrigin();
  if (!origin) {
    logger.warn("Sense webhook not registered: the app URL is not HTTPS", {
      companyId,
      appUrl: getAppUrl()
    });
    return;
  }

  const serviceRole = getCarbonServiceRole();
  const row = await serviceRole
    .from("companyIntegration")
    .select("metadata, secretRef, active")
    .eq("companyId", companyId)
    .eq("id", SENSE)
    .maybeSingle();
  if (row.error) throw row.error;
  if (!row.data?.active) return;

  const metadata = (await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    SENSE,
    row.data.metadata,
    row.data.secretRef
  )) as Record<string, unknown>;
  const provider = senseFromMetadata(metadata);
  const url = senseWebhookUrl(origin, companyId);

  const existing = await provider.getWebhook();
  let secret: string | null = null;
  if (!existing) {
    ({ secret } = await provider.createWebhook(url));
  } else {
    const keepSecret =
      existing.url === url &&
      existing.enabled &&
      Boolean(metadata[WEBHOOK_SIGNING_SECRET_KEY]);
    await provider.updateWebhook(existing.id, url);
    if (!keepSecret) {
      ({ secret } = await provider.rotateWebhookSecret(existing.id));
    }
  }

  // Stored before the webhook is enabled, so the first delivery verifies.
  if (secret) {
    await patchIntegrationState(serviceRole, companyId, SENSE, {
      secrets: { [WEBHOOK_SIGNING_SECRET_KEY]: secret }
    });
  }
  if (existing && !existing.enabled) {
    await provider.enableWebhook(existing.id);
  }
}

/**
 * Disconnecting Sense stops its sync, so nothing would ever close the time its
 * sensors opened: each device's open sensor Machine event and running
 * unattributed time end now, under the device lock, and the ended events
 * post. The device mappings stay, so reconnecting resumes from where each
 * device left off.
 */
export async function senseOnUninstall(companyId: string) {
  const db = getPostgresClient<KyselyDatabase>(
    getProcessPool(),
    PostgresDriver
  );
  const devices = await db
    .selectFrom("workCenterDevice")
    .select("workCenterId")
    .where("companyId", "=", companyId)
    .where("integration", "=", "sense")
    .execute();
  const at = datetime.timestamp();
  for (const { workCenterId } of devices) {
    const { endedEventIds } = await db.transaction().execute(async (trx) => {
      await lockWorkCenterDevice(trx, { workCenterId, companyId });
      return endSensorMachineTime(trx, {
        workCenterId,
        companyId,
        userId: "system",
        at
      });
    });
    await postEndedMachineEvents(db, {
      companyId,
      userId: "system",
      productionEventIds: endedEventIds
    });
  }
}
