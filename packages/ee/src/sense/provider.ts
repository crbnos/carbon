// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  type MachineState,
  type OeeDevice,
  type OeeProvider,
  OeeProviderUnavailableError,
  type OeeStateChange
} from "../oee/types";

/**
 * Sense Manufacturing — clip-on current sensors, one "station" per machine.
 * The public API is company-scoped by its key (`/v1/public/companies/...`)
 * and has no webhooks, so the OEE sync polls it.
 */

const SENSE_HOSTS = {
  production: "https://bifrost.sensemfg.com",
  staging: "http://bifrost-staging.sensemfg.com"
} as const;

export type SenseEnvironment = keyof typeof SENSE_HOSTS;

const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The status → state allowlist. An unknown status fails the station rather
 * than being guessed (`.ai/lessons.md` → explicit verified allowlists).
 */
const SENSE_STATES: Record<string, MachineState> = {
  Active: "Running",
  Idle: "Idle",
  Alert: "Down",
  Offline: "Offline"
};

export class SenseApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SenseApiError";
  }
}

type SenseSite = { id: string; name: string; timezone: string | null };

type SenseStation = {
  id: string;
  machine_name: string | null;
  machine_manufacturer: string | null;
  machine_type: string | null;
  machine_model: string | null;
  site_id: string | null;
  last_calibration_attempt_status: string | null;
};

type SenseEvent = { id: string; status: string; created_at: string };

export class SenseProvider implements OeeProvider {
  readonly id = "sense" as const;
  private readonly host: string;
  private readonly apiKey: string;

  constructor(args: { apiKey: string; environment: SenseEnvironment }) {
    this.apiKey = args.apiKey;
    this.host = SENSE_HOSTS[args.environment];
  }

  private async get<T>(
    path: string,
    query: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(path, this.host);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OeeProviderUnavailableError(`Sense ${path} failed: ${message}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status >= 500) {
        throw new OeeProviderUnavailableError(
          `Sense ${path} failed with ${response.status}: ${body.slice(0, 300)}`
        );
      }
      throw new SenseApiError(
        response.status,
        `Sense ${path} failed with ${response.status}: ${body.slice(0, 300)}`
      );
    }
    return (await response.json()) as T;
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.get<{ sites: SenseSite[] }>("/v1/public/companies/sites");
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async listDevices(): Promise<OeeDevice[]> {
    const [stations, sites] = await Promise.all([
      this.get<{ stations: SenseStation[] }>("/v1/public/companies/stations"),
      this.get<{ sites: SenseSite[] }>("/v1/public/companies/sites")
    ]);
    const siteById = new Map(sites.sites.map((site) => [site.id, site]));

    return stations.stations.map((station) => {
      const site = station.site_id ? siteById.get(station.site_id) : undefined;
      const calibration = station.last_calibration_attempt_status;
      return {
        externalDeviceId: station.id,
        name: station.machine_name ?? station.id,
        externalSiteId: station.site_id,
        siteName: site?.name ?? null,
        siteTimezone: site?.timezone ?? null,
        manufacturer: station.machine_manufacturer,
        model: station.machine_model,
        machineType: station.machine_type,
        calibrated: calibration === null ? null : calibration === "CALIBRATED"
      };
    });
  }

  /**
   * Sense ignores `offset` (and rejects `offset=0`), so this pages by time:
   * a full page is followed by a request from its last event's `created_at`,
   * and events already returned are dropped by id.
   */
  async listStateChanges(
    device: { externalDeviceId: string; externalSiteId: string | null },
    window: { since: string; until: string }
  ): Promise<OeeStateChange[]> {
    if (!device.externalSiteId) {
      throw new SenseApiError(0, "Station has no site");
    }
    const path = `/v1/public/companies/sites/${encodeURIComponent(
      device.externalSiteId
    )}/stations/${encodeURIComponent(device.externalDeviceId)}/events`;

    const seen = new Set<string>();
    const changes: OeeStateChange[] = [];
    let start = window.since;

    for (;;) {
      const page = await this.get<{ events: SenseEvent[] }>(path, {
        start_datetime: start,
        end_datetime: window.until,
        order: "asc",
        limit: String(PAGE_SIZE)
      });

      let added = 0;
      for (const event of page.events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        const state = SENSE_STATES[event.status];
        if (!state) {
          throw new SenseApiError(0, `Unknown Sense status: ${event.status}`);
        }
        changes.push({
          externalEventId: event.id,
          state,
          changedAt: event.created_at
        });
        added++;
      }

      const last = page.events.at(-1);
      if (page.events.length < PAGE_SIZE || added === 0 || !last) break;
      start = last.created_at;
    }

    return changes;
  }
}
