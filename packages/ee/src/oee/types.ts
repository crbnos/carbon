// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/** Mirrors the `machineState` database enum. */
export type MachineState = "Running" | "Idle" | "Down" | "Offline";

export type OeeProviderId = "sense";

/** A machine-monitoring device as its provider reports it. */
export interface OeeDevice {
  externalDeviceId: string;
  name: string;
  externalSiteId: string | null;
  siteName: string | null;
  siteTimezone: string | null;
  manufacturer: string | null;
  model: string | null;
  machineType: string | null;
  calibrated: boolean | null;
}

/** One state change of one device. `changedAt` is a UTC ISO 8601 instant. */
export interface OeeStateChange {
  externalEventId: string;
  state: MachineState;
  changedAt: string;
}

/**
 * The contract every OEE provider implements. The sync job, the device
 * mapping screen and the attribution engine know only this interface.
 */
export interface OeeProvider {
  id: OeeProviderId;
  validate(): Promise<{ valid: boolean; error?: string }>;
  listDevices(): Promise<OeeDevice[]>;
  listStateChanges(
    device: { externalDeviceId: string; externalSiteId: string | null },
    window: { since: string; until: string }
  ): Promise<OeeStateChange[]>;
}
