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
import { createOeeProvider } from "../oee/registry";
import { postEndedMachineEvents } from "../oee/service.server";
import type { IntegrationHealthcheckResult } from "../types";

/** `metadata` arrives with the vaulted `apiKey` already resolved. */
export async function senseHealthcheck(
  _companyId: string,
  metadata: Record<string, unknown>
): Promise<IntegrationHealthcheckResult> {
  let provider: ReturnType<typeof createOeeProvider>["provider"];
  try {
    provider = createOeeProvider("sense", metadata).provider;
  } catch (error) {
    return {
      healthy: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  const { valid, error } = await provider.validate();
  return { healthy: valid, reason: error };
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
