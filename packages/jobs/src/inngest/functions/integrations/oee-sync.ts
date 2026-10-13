// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Syncs every mapped device of one company's OEE integration. All devices run
 * in ONE step: a step per device would multiply the Inngest cost by the device
 * count every 2 minutes. Each device is isolated — a failure is recorded on
 * that device (`lastSyncError`) and keeps its cursor; the others continue.
 * An `OeeProviderUnavailableError` stops the run instead: every remaining
 * device would fail the same way.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { OeeProviderUnavailableError } from "@carbon/ee/oee";
import { getOeeProvider } from "@carbon/ee/oee.server";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import { syncOeeDevice } from "./oee-sync-device";

const MAX_ERROR_LENGTH = 500;

export const oeeSyncFunction = inngest.createFunction(
  {
    id: "oee-sync",
    retries: 2,
    concurrency: { key: "event.data.companyId", limit: 1 },
    singleton: {
      key: "event.data.companyId + '-' + event.data.integrationId",
      mode: "skip"
    }
  },
  { event: "carbon/oee-sync" },
  async ({ event, step }) => {
    const { companyId, integrationId } = event.data as {
      companyId: string;
      integrationId: string;
    };

    return step.run("sync-devices", async () => {
      const resolved = await getOeeProvider(
        getCarbonServiceRole(),
        companyId,
        integrationId
      );
      if (resolved.error !== null) {
        return { companyId, integrationId, skipped: resolved.error };
      }
      const { provider, minimumStateSeconds } = resolved.data;

      const db = getJobDatabaseClient();
      const devices = await db
        .selectFrom("workCenterDevice")
        .select([
          "id",
          "companyId",
          "workCenterId",
          "externalDeviceId",
          "externalSiteId",
          "currentState",
          "currentStateAt",
          "appliedThrough",
          "lastEventAt",
          "lastManualChangeAt",
          "lastSyncedAt",
          "createdAt"
        ])
        .where("companyId", "=", companyId)
        .where("integration", "=", integrationId)
        .execute();

      const failed: string[] = [];
      let stopped: string | undefined;
      for (const device of devices) {
        try {
          await syncOeeDevice({ db, provider, device, minimumStateSeconds });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `[OEE SYNC] ${companyId}/${integrationId}: device ${device.id} failed`,
            error
          );
          failed.push(device.id);
          await db
            .updateTable("workCenterDevice")
            .set({ lastSyncError: message.slice(0, MAX_ERROR_LENGTH) })
            .where("id", "=", device.id)
            .where("companyId", "=", companyId)
            .execute()
            .catch((writeError) =>
              console.error(
                `[OEE SYNC] ${companyId}: could not record the error on ${device.id}`,
                writeError
              )
            );
          // The provider is down: every other device would fail the same way.
          if (error instanceof OeeProviderUnavailableError) {
            stopped = message;
            break;
          }
        }
      }

      return {
        companyId,
        integrationId,
        devices: devices.length,
        failed,
        ...(stopped ? { stopped } : {})
      };
    });
  }
);
