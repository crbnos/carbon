// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import type { OeeDevice } from "@carbon/ee/oee";
import {
  deleteWorkCenterDevice,
  getOeeProvider,
  upsertWorkCenterDevice
} from "@carbon/ee/oee.server";
import { validationError, validator } from "@carbon/form";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { oeeDevicesCacheKey } from "./oee-devices-cache";
import { workCenterDeviceUpsertValidator } from "./settings.models";

const logger = getLogger("erp", "oee-devices");

// Picking a work center revalidates the tab, and a mapping change does not
// change the provider's device list. A short TTL keeps those revalidations off
// the provider. A change to the integration's connection (its API key or
// environment) clears it: `clearCompanyIntegrationCache` deletes these keys.
// The @carbon/kv wrapper fails soft: a Redis miss or outage just calls the
// provider.
const DEVICES_TTL_SECONDS = 60;

async function getCachedDevices(
  companyId: string,
  integrationId: string
): Promise<OeeDevice[] | null> {
  const key = oeeDevicesCacheKey(companyId, integrationId);
  const cached = await redis.get(key);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as OeeDevice[];
  } catch (err) {
    logger.error("Failed to parse cached OEE devices", {
      companyId,
      integrationId,
      error: err
    });
    await redis.del(key);
    return null;
  }
}

/**
 * The provider's devices for an OEE integration, cached for 60 seconds. A
 * provider error is never cached.
 */
async function listOeeDevices(
  companyId: string,
  integrationId: string
): Promise<{ devices: OeeDevice[]; error: string | null }> {
  const cached = await getCachedDevices(companyId, integrationId);
  if (cached) return { devices: cached, error: null };

  let error: string | null = null;
  try {
    const oee = await getOeeProvider(
      getCarbonServiceRole(),
      companyId,
      integrationId
    );
    if (oee.error || !oee.data) {
      error = oee.error ?? "Could not connect to the provider";
    } else {
      const devices = await oee.data.provider.listDevices();
      await redis.set(
        oeeDevicesCacheKey(companyId, integrationId),
        JSON.stringify(devices),
        "EX",
        DEVICES_TTL_SECONDS
      );
      return { devices, error: null };
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  logger.error("Failed to list OEE devices", {
    companyId,
    integrationId,
    error
  });
  return { devices: [], error };
}

/**
 * Device-mapping data for an OEE integration's Devices tab: the provider's
 * devices, this integration's saved mappings, the work centers another OEE
 * integration already holds, and the active work centers (plus any inactive
 * one a device of this integration is still mapped to) with their location
 * timezone. A provider failure renders the mappings with no devices and the
 * error above the list rather than failing the drawer. The device list is
 * cached for 60 seconds; a provider error is never cached.
 */
export async function getOeeDevicesTabData(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
) {
  // The provider read runs alongside the mappings. Mappings come before the
  // work centers: the work center list must include an inactive work center a
  // device is still mapped to, or its row shows no work center.
  const [{ devices, error: providerError }, mappings] = await Promise.all([
    listOeeDevices(companyId, integrationId),
    client
      .from("workCenterDevice")
      .select(
        "externalDeviceId, deviceName, externalSiteId, siteTimezone, workCenterId, currentState, lastSyncedAt, lastSyncError"
      )
      .eq("companyId", companyId)
      .eq("integration", integrationId)
  ]);

  const mappedIds = (mappings.data ?? []).map((m) => m.workCenterId);
  const workCentersQuery = client
    .from("workCenter")
    .select("id, name, location(timezone)")
    .eq("companyId", companyId);

  const [takenWorkCenters, workCenters] = await Promise.all([
    client
      .from("workCenterDevice")
      .select("workCenterId, deviceName, integration")
      .eq("companyId", companyId)
      .neq("integration", integrationId),
    (mappedIds.length > 0
      ? workCentersQuery.or(`active.eq.true,id.in.(${mappedIds.join(",")})`)
      : workCentersQuery.eq("active", true)
    ).order("name")
  ]);

  for (const result of [mappings, takenWorkCenters, workCenters]) {
    if (result.error) {
      logger.error("Failed to load OEE device mapping data", {
        companyId,
        integrationId,
        error: result.error
      });
    }
  }

  return {
    devices,
    mappings: mappings.data ?? [],
    takenWorkCenters: takenWorkCenters.data ?? [],
    workCenters: (workCenters.data ?? []).map((workCenter) => ({
      id: workCenter.id,
      name: workCenter.name,
      // Null when the location inherits the company's timezone ('' or null):
      // the tab falls back to the company's.
      locationTimezone: workCenter.location?.timezone || null
    })),
    error: providerError
  };
}

/**
 * Map or unmap one device (Devices tab of an OEE integration). An empty work
 * center unmaps. Returns the action response: the tab stays on the page and
 * revalidates in place.
 */
export async function saveWorkCenterDeviceMapping(
  request: Request,
  formData: FormData,
  {
    client,
    companyId,
    userId,
    integrationId
  }: {
    client: SupabaseClient<Database>;
    companyId: string;
    userId: string;
    integrationId: string;
  }
) {
  const validation = await validator(workCenterDeviceUpsertValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { externalDeviceId, deviceName, workCenterId } = validation.data;

  // Map only a station the current connection reports: a list read before
  // the API key changed could name a station this provider does not have,
  // and its mapping would never sync. The stored name, site and timezone are
  // the provider's, not the form's.
  let device: OeeDevice | undefined;
  if (workCenterId) {
    const provider = await listOeeDevices(companyId, integrationId);
    device = provider.devices.find(
      (candidate) => candidate.externalDeviceId === externalDeviceId
    );
    if (!device) {
      const message =
        provider.error ?? `${deviceName} is not a station of this provider`;
      return data(
        {},
        await flash(
          request,
          error(message, `Failed to save device mapping: ${message}`)
        )
      );
    }
  }

  let result: { error: string | null };
  try {
    result =
      workCenterId && device
        ? await upsertWorkCenterDevice(client, getDatabaseClient(), {
            companyId,
            userId,
            integration: integrationId,
            externalDeviceId,
            externalSiteId: device.externalSiteId,
            siteTimezone: device.siteTimezone,
            deviceName: device.name,
            workCenterId
          })
        : await deleteWorkCenterDevice(client, getDatabaseClient(), {
            companyId,
            userId,
            integration: integrationId,
            externalDeviceId
          });
  } catch (err) {
    if (!(err instanceof EntitlementError)) throw err;
    logger.error("OEE device mapping refused: not entitled", {
      companyId,
      integrationId,
      error: err
    });
    result = { error: err.message };
  }

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, `Failed to save device mapping: ${result.error}`)
      )
    );
  }

  return data({}, await flash(request, success("Saved device mapping")));
}
