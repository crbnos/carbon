// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Two ways in, one device loop. `oee-device-sync` is the primary path: a
 * provider webhook names the device that changed, and only it syncs.
 * `oee-sync` is the fallback the sweep fires every 10 minutes, for every mapped
 * device of the integration: it catches a lost delivery and moves time when a
 * load changes on a machine that is still running.
 *
 * All devices of a run share ONE step: a step per device would multiply the
 * Inngest cost by the device count. The Machine events a device's sync ends
 * post to the GL right after it commits. Each device is isolated — a failure is
 * recorded on that device (`lastSyncError`) and keeps its cursor; the others
 * continue. An `OeeProviderUnavailableError` stops the run instead: every
 * remaining device would fail the same way. A change too short to apply yet
 * schedules an `oee-device-sync` for when it has lasted the minimum.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { OeeProviderUnavailableError } from "@carbon/ee/oee";
import { getOeeProvider, postEndedMachineEvents } from "@carbon/ee/oee.server";
import { parseAbsolute } from "@internationalized/date";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import { syncOeeDevice } from "./oee-sync-device";

const MAX_ERROR_LENGTH = 500;

/**
 * The sweep's run and a webhook's run never overlap for one company: each
 * reads a device's cursor before it locks the device, and a stale read would
 * move `lastEventAt` backwards.
 */
const COMPANY_CONCURRENCY = {
  scope: "env" as const,
  key: '"oee:" + event.data.companyId',
  limit: 1
};

type Recheck = { externalDeviceId: string; at: string };

async function syncDevices({
  companyId,
  integrationId,
  externalDeviceId
}: {
  companyId: string;
  integrationId: string;
  /** One device (a webhook), or every mapped device (the sweep). */
  externalDeviceId?: string;
}) {
  const resolved = await getOeeProvider(
    getCarbonServiceRole(),
    companyId,
    integrationId
  );
  if (resolved.error !== null) {
    const rechecks: Recheck[] = [];
    return { companyId, integrationId, skipped: resolved.error, rechecks };
  }
  const { provider, minimumStateSeconds } = resolved.data;

  const db = getJobDatabaseClient();
  let query = db
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
    .where("integration", "=", integrationId);
  if (externalDeviceId !== undefined) {
    query = query.where("externalDeviceId", "=", externalDeviceId);
  }
  const devices = await query.execute();

  const failed: string[] = [];
  const rechecks: Recheck[] = [];
  let stopped: string | undefined;
  for (const device of devices) {
    try {
      const { endedEventIds, recheckAt } = await syncOeeDevice({
        db,
        provider,
        device,
        minimumStateSeconds
      });
      if (recheckAt) {
        rechecks.push({
          externalDeviceId: device.externalDeviceId,
          at: recheckAt
        });
      }
      // Sensor time posts when it ends, as an operator's press does.
      await postEndedMachineEvents(db, {
        companyId,
        userId: "system",
        productionEventIds: endedEventIds
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    rechecks,
    ...(stopped ? { stopped } : {})
  };
}

/** Delayed `oee-device-sync` events for the changes still pending. */
function recheckEvents(
  companyId: string,
  integrationId: string,
  rechecks: Recheck[]
) {
  return rechecks.map((recheck) => ({
    name: "carbon/oee-device-sync" as const,
    data: {
      companyId,
      integrationId,
      externalDeviceId: recheck.externalDeviceId
    },
    // An absolute instant, so epoch milliseconds are timezone-free.
    ts: parseAbsolute(recheck.at, "UTC").toDate().getTime()
  }));
}

export const oeeSyncFunction = inngest.createFunction(
  {
    id: "oee-sync",
    retries: 2,
    concurrency: [COMPANY_CONCURRENCY],
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

    const result = await step.run("sync-devices", () =>
      syncDevices({ companyId, integrationId })
    );
    if (result.rechecks.length > 0) {
      await step.sendEvent(
        "schedule-rechecks",
        recheckEvents(companyId, integrationId, result.rechecks)
      );
    }
    return result;
  }
);

export const oeeDeviceSyncFunction = inngest.createFunction(
  {
    id: "oee-device-sync",
    retries: 2,
    concurrency: [COMPANY_CONCURRENCY],
    // A burst of deliveries for one device is one sync: it reads every
    // change since the device's cursor anyway.
    debounce: {
      key: "event.data.companyId + '-' + event.data.integrationId + '-' + event.data.externalDeviceId",
      period: "5s",
      timeout: "30s"
    }
  },
  { event: "carbon/oee-device-sync" },
  async ({ event, step }) => {
    const { companyId, integrationId, externalDeviceId } = event.data as {
      companyId: string;
      integrationId: string;
      externalDeviceId: string;
    };

    const result = await step.run("sync-device", () =>
      syncDevices({ companyId, integrationId, externalDeviceId })
    );
    if (result.rechecks.length > 0) {
      await step.sendEvent(
        "schedule-recheck",
        recheckEvents(companyId, integrationId, result.rechecks)
      );
    }
    return result;
  }
);
