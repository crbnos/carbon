// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Combobox, Submit, ValidatedForm } from "@carbon/form";
import {
  Badge,
  DrawerBody,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { LuArrowRight, LuTriangleAlert } from "react-icons/lu";
import RulesUpgradeOverlay from "~/components/RulesUpgradeOverlay";
import { useDateFormatter, usePermissions } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { workCenterDeviceUpsertValidator } from "~/modules/settings/settings.models";

/**
 * Local structural mirrors of @carbon/ee/oee's OeeDevice and the
 * workCenterDevice rows. Deliberately NOT imported (even type-only) for the
 * same TS2589 reason as AccountMapping.tsx. The route's loader passes real
 * rows, so any drift fails typecheck there.
 */
export type OeeDeviceRow = {
  externalDeviceId: string;
  name: string;
  externalSiteId: string | null;
  siteName: string | null;
  siteTimezone: string | null;
  manufacturer: string | null;
  model: string | null;
  machineType: string | null;
  calibrated: boolean | null;
};

export type OeeDeviceMappingRow = {
  externalDeviceId: string;
  deviceName: string;
  externalSiteId: string | null;
  siteTimezone: string | null;
  workCenterId: string;
  currentState: "Running" | "Idle" | "Down" | "Offline" | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

export type OeeTakenWorkCenterRow = {
  workCenterId: string;
  deviceName: string;
  integration: string;
};

export type OeeWorkCenterRow = {
  id: string;
  name: string;
  locationTimezone: string | null;
};

type OeeDevicesProps = {
  /** Shared tab bar, rendered at the top of this tab's body card. */
  tabs?: ReactNode;
  devices: OeeDeviceRow[];
  mappings: OeeDeviceMappingRow[];
  /** Work centers another OEE integration already holds. */
  takenWorkCenters: OeeTakenWorkCenterRow[];
  workCenters: OeeWorkCenterRow[];
  /** The provider's device list failed to load. */
  error: string | null;
};

const STATE_BADGE_VARIANT = {
  Running: "green",
  Idle: "yellow",
  Down: "red",
  Offline: "gray"
} as const;

export function OeeDevices({
  tabs,
  devices,
  mappings,
  takenWorkCenters,
  workCenters,
  error
}: OeeDevicesProps) {
  const permissions = usePermissions();
  const { isGated } = usePlanGate({ feature: "INTEGRATIONS" });

  return (
    <DrawerBody className="gap-6">
      {tabs}
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        <Trans>
          Map each machine to the work center it runs at. Carbon reads the
          machine's state changes from the moment you save the mapping.
        </Trans>
      </p>
      {isGated ? (
        <RulesUpgradeOverlay
          preview={
            <OeeDeviceList
              devices={mockDevices}
              mappings={[]}
              takenWorkCenters={[]}
              workCenters={[]}
              canUpdate={false}
            />
          }
          title={<Trans>Machine monitoring</Trans>}
          description={
            <Trans>
              Connect machine monitoring devices to work centers so machine time
              is recorded against the operation that is loaded.
            </Trans>
          }
        />
      ) : (
        <>
          {error && (
            <div className="w-full rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          <OeeDeviceList
            devices={devices}
            mappings={mappings}
            takenWorkCenters={takenWorkCenters}
            workCenters={workCenters}
            canUpdate={permissions.can("update", "settings")}
          />
        </>
      )}
    </DrawerBody>
  );
}

const mockDevices: OeeDeviceRow[] = [
  {
    externalDeviceId: "mock-1",
    name: "Haas VF-2",
    externalSiteId: null,
    siteName: "Main Plant",
    siteTimezone: null,
    manufacturer: "Haas",
    model: "VF-2",
    machineType: "Vertical Mill",
    calibrated: true
  },
  {
    externalDeviceId: "mock-2",
    name: "Mazak QT-250",
    externalSiteId: null,
    siteName: "Main Plant",
    siteTimezone: null,
    manufacturer: "Mazak",
    model: "QT-250",
    machineType: "Lathe",
    calibrated: false
  }
];

function OeeDeviceList({
  devices,
  mappings,
  takenWorkCenters,
  workCenters,
  canUpdate
}: {
  devices: OeeDeviceRow[];
  mappings: OeeDeviceMappingRow[];
  takenWorkCenters: OeeTakenWorkCenterRow[];
  workCenters: OeeWorkCenterRow[];
  canUpdate: boolean;
}) {
  const mappedByDeviceId = useMemo(
    () =>
      new Map(mappings.map((mapping) => [mapping.externalDeviceId, mapping])),
    [mappings]
  );
  const workCenterById = useMemo(
    () => new Map(workCenters.map((workCenter) => [workCenter.id, workCenter])),
    [workCenters]
  );
  // A work center holds one device across every OEE provider: leave the ones
  // another integration already maps out of the options.
  const workCenterOptions = useMemo(() => {
    const taken = new Set(takenWorkCenters.map((row) => row.workCenterId));
    return workCenters
      .filter((workCenter) => !taken.has(workCenter.id))
      .map((workCenter) => ({ value: workCenter.id, label: workCenter.name }));
  }, [workCenters, takenWorkCenters]);

  // A mapped device stays listed when the provider cannot list its devices
  // (a slow or failing API), so it can still be seen and unmapped.
  const rows = useMemo(() => {
    const listed = new Set(devices.map((device) => device.externalDeviceId));
    const mappedOnly: OeeDeviceRow[] = mappings
      .filter((mapping) => !listed.has(mapping.externalDeviceId))
      .map((mapping) => ({
        externalDeviceId: mapping.externalDeviceId,
        name: mapping.deviceName,
        externalSiteId: mapping.externalSiteId,
        siteName: null,
        siteTimezone: mapping.siteTimezone,
        manufacturer: null,
        model: null,
        machineType: null,
        calibrated: null
      }));
    return [...mappedOnly, ...devices];
  }, [devices, mappings]);

  if (rows.length === 0) {
    return (
      <div className="flex w-full items-center justify-center rounded-lg border border-border py-8 text-sm text-muted-foreground max-md:border-0 max-md:rounded-none">
        <Trans>No devices found</Trans>
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-border max-md:border-0 max-md:p-0 max-md:rounded-none">
      <div className="flex w-full flex-col divide-y divide-border">
        {rows.map((device) => {
          const mapping = mappedByDeviceId.get(device.externalDeviceId);
          return (
            // Keyed on the persisted work center so a saved change remounts
            // the row and re-seeds its Combobox from fresh loader data (see
            // AccountMapping.tsx).
            <OeeDeviceRowForm
              key={`${device.externalDeviceId}:${mapping?.workCenterId ?? ""}`}
              device={device}
              mapping={mapping ?? null}
              workCenterById={workCenterById}
              workCenterOptions={workCenterOptions}
              canUpdate={canUpdate}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One provider device → Carbon work center row. Each row is its own
 * ValidatedForm posting intent=upsert-work-center-device; clearing the work
 * center unmaps the device.
 */
function OeeDeviceRowForm({
  device,
  mapping,
  workCenterById,
  workCenterOptions,
  canUpdate
}: {
  device: OeeDeviceRow;
  mapping: OeeDeviceMappingRow | null;
  workCenterById: Map<string, OeeWorkCenterRow>;
  workCenterOptions: { value: string; label: string }[];
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const { formatTimeAgo } = useDateFormatter();
  // The user's pick this session; until they edit, the saved mapping wins.
  const [selected, setSelected] = useState<{ id: string | null } | null>(null);
  const selectedWorkCenterId = selected
    ? selected.id
    : (mapping?.workCenterId ?? null);
  const locationTimezone = selectedWorkCenterId
    ? (workCenterById.get(selectedWorkCenterId)?.locationTimezone ?? null)
    : null;
  const timezoneMismatch =
    device.siteTimezone !== null &&
    locationTimezone !== null &&
    device.siteTimezone !== locationTimezone;

  const stateLabels = {
    Running: t`Running`,
    Idle: t`Idle`,
    Down: t`Down`,
    Offline: t`Offline`
  } as const;

  const details = [device.manufacturer, device.model, device.machineType]
    .filter(Boolean)
    .join(" · ");

  return (
    <ValidatedForm
      validator={workCenterDeviceUpsertValidator}
      method="post"
      defaultValues={{
        intent: "upsert-work-center-device",
        externalDeviceId: device.externalDeviceId,
        deviceName: device.name,
        externalSiteId: device.externalSiteId ?? undefined,
        siteTimezone: device.siteTimezone ?? undefined,
        workCenterId: mapping?.workCenterId ?? undefined
      }}
      className="flex w-full items-center gap-3 p-3"
    >
      <input type="hidden" name="intent" value="upsert-work-center-device" />
      <input
        type="hidden"
        name="externalDeviceId"
        value={device.externalDeviceId}
      />
      <input type="hidden" name="deviceName" value={device.name} />
      <input
        type="hidden"
        name="externalSiteId"
        value={device.externalSiteId ?? ""}
      />
      <input
        type="hidden"
        name="siteTimezone"
        value={device.siteTimezone ?? ""}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{device.name}</span>
          {device.calibrated !== null && (
            <Badge variant={device.calibrated ? "green" : "yellow"}>
              {device.calibrated ? (
                <Trans>Calibrated</Trans>
              ) : (
                <Trans>Not calibrated</Trans>
              )}
            </Badge>
          )}
          {mapping?.currentState && (
            <Badge variant={STATE_BADGE_VARIANT[mapping.currentState]}>
              {stateLabels[mapping.currentState]}
            </Badge>
          )}
        </div>
        {details && (
          <span className="truncate text-xs text-muted-foreground">
            {details}
          </span>
        )}
        {device.siteName && (
          <span className="truncate text-xs text-muted-foreground">
            {device.siteName}
          </span>
        )}
        {mapping?.lastSyncedAt && (
          <span className="text-xs text-muted-foreground">
            <Trans>Synced {formatTimeAgo(mapping.lastSyncedAt)}</Trans>
          </span>
        )}
        {mapping?.lastSyncError && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {mapping.lastSyncError}
          </span>
        )}
      </div>
      {timezoneMismatch ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0">
              <LuTriangleAlert className="size-4 text-amber-500" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <Trans>
              Sense site is in {device.siteTimezone}; Carbon uses{" "}
              {locationTimezone}
            </Trans>
          </TooltipContent>
        </Tooltip>
      ) : (
        <LuArrowRight className="size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="w-[260px] shrink-0">
        <Combobox
          name="workCenterId"
          options={workCenterOptions}
          placeholder={t`Select work center`}
          isOptional
          onChange={(option) => setSelected({ id: option?.value ?? null })}
        />
      </div>
      <Submit size="sm" variant="secondary" isDisabled={!canUpdate}>
        <Trans>Save</Trans>
      </Submit>
    </ValidatedForm>
  );
}
