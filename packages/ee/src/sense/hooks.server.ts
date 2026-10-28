// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { KyselyDatabase } from "@carbon/database/client";
import { getPostgresClient, getProcessPool } from "@carbon/database/client";
import {
  endSensorMachineTime,
  lockWorkCenterDevice
} from "@carbon/database/machine-time";
import { datetime } from "@carbon/utils";
import { PostgresDriver } from "kysely";
import { WEBHOOK_SIGNING_SECRET_KEY } from "../integrations/secrets";
import { postEndedMachineEvents } from "../oee/service.server";
import type { IntegrationHealthcheckResult } from "../types";
import { senseWebhookUrl } from "./webhook";
import { senseFromMetadata, webhookOrigin } from "./webhook.server";

export { ensureSenseWebhook } from "./webhook.server";

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
