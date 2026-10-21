// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { useAction } from "@carbon/query";
import {
  Combobox,
  cn,
  DrawerBody,
  Input,
  InputGroup,
  InputLeftElement,
  Table,
  Tbody,
  Td,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Fragment, useMemo, useState } from "react";
import { LuSearch, LuTriangleAlert } from "react-icons/lu";
import RulesUpgradeOverlay from "~/components/RulesUpgradeOverlay";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCompanyTimeZone } from "~/hooks/useCompanyTimeZone";
import { usePlanGate } from "~/hooks/usePlanGate";

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
  /** Null when the location inherits the company's timezone. */
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

export function OeeDevices({
  tabs,
  devices,
  mappings,
  takenWorkCenters,
  workCenters,
  error
}: OeeDevicesProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { isGated } = usePlanGate({ feature: "INTEGRATIONS" });

  return (
    <DrawerBody className="gap-4">
      {tabs}
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
          title={t`Machine monitoring`}
          description={t`Connect machine monitoring devices to work centers so machine time is recorded against the operation that is loaded.`}
        />
      ) : (
        <>
          {error && (
            <p className="flex w-full items-start gap-2 text-sm text-muted-foreground">
              <LuTriangleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
              <span className="min-w-0">
                <Trans>
                  Could not list the provider's devices. Mapped devices are
                  still shown.
                </Trans>{" "}
                <span className="text-xs">{error}</span>
              </span>
            </p>
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
    externalSiteId: "mock-site",
    siteName: "Main Plant",
    siteTimezone: null,
    manufacturer: "Haas",
    model: "VF-2",
    machineType: null,
    calibrated: true
  },
  {
    externalDeviceId: "mock-2",
    name: "Mazak QT-250",
    externalSiteId: "mock-site",
    siteName: "Main Plant",
    siteTimezone: null,
    manufacturer: "Mazak",
    model: "QT-250",
    machineType: null,
    calibrated: true
  }
];

type SiteGroup = {
  key: string;
  name: string | null;
  timezone: string | null;
  devices: OeeDeviceRow[];
};

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
  const { t } = useLingui();
  const [search, setSearch] = useState("");

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
  // another integration already maps out of the options. The ones another
  // device of this integration holds are left out per row, below.
  const workCenterOptions = useMemo(() => {
    const taken = new Set(takenWorkCenters.map((row) => row.workCenterId));
    return workCenters
      .filter((workCenter) => !taken.has(workCenter.id))
      .map((workCenter) => ({ value: workCenter.id, label: workCenter.name }));
  }, [workCenters, takenWorkCenters]);
  const deviceIdByWorkCenterId = useMemo(
    () =>
      new Map(
        mappings.map((mapping) => [
          mapping.workCenterId,
          mapping.externalDeviceId
        ])
      ),
    [mappings]
  );

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

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = term
      ? rows.filter((device) =>
          [device.name, device.manufacturer, device.model, device.siteName]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(term))
        )
      : rows;
    const bySite = new Map<string, SiteGroup>();
    for (const device of matches) {
      const key = device.externalSiteId ?? "";
      const group = bySite.get(key) ?? {
        key,
        name: device.siteName,
        timezone: device.siteTimezone,
        devices: []
      };
      group.name ??= device.siteName;
      group.devices.push(device);
      bySite.set(key, group);
    }
    const collator = new Intl.Collator(undefined, { numeric: true });
    return [...bySite.values()]
      .map((group) => ({
        ...group,
        devices: group.devices.sort((a, b) => collator.compare(a.name, b.name))
      }))
      .sort((a, b) => collator.compare(a.name ?? "", b.name ?? ""));
  }, [rows, search]);

  const mappedCount = rows.filter((device) =>
    mappedByDeviceId.has(device.externalDeviceId)
  ).length;
  const totalCount = rows.length;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="w-full max-w-[280px]">
          <InputGroup size="sm">
            <InputLeftElement>
              <LuSearch className="size-4 text-muted-foreground" />
            </InputLeftElement>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t`Search devices`}
            />
          </InputGroup>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          <Trans>
            {mappedCount} of {totalCount} mapped
          </Trans>
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="w-full py-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? (
            <Trans>No devices found</Trans>
          ) : (
            <Trans>No devices match your search</Trans>
          )}
        </p>
      ) : (
        <Table full>
          <Tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                <Tr className="border-b border-border">
                  <Td
                    colSpan={2}
                    className="px-0 pb-2 pt-5 text-xs font-medium text-muted-foreground"
                  >
                    {group.name ?? <Trans>Mapped devices</Trans>}
                    {group.timezone && (
                      <span className="font-normal"> · {group.timezone}</span>
                    )}
                  </Td>
                </Tr>
                {group.devices.map((device) => {
                  const mapping = mappedByDeviceId.get(device.externalDeviceId);
                  return (
                    <OeeDeviceTableRow
                      key={`${device.externalDeviceId}:${mapping?.workCenterId ?? ""}`}
                      device={device}
                      mapping={mapping ?? null}
                      workCenterById={workCenterById}
                      workCenterOptions={workCenterOptions}
                      deviceIdByWorkCenterId={deviceIdByWorkCenterId}
                      canUpdate={canUpdate}
                    />
                  );
                })}
              </Fragment>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}

/**
 * One provider device → Carbon work center. Picking a work center saves at
 * once (intent upsert-work-center-device); clearing it unmaps the device.
 */
function OeeDeviceTableRow({
  device,
  mapping,
  workCenterById,
  workCenterOptions,
  deviceIdByWorkCenterId,
  canUpdate
}: {
  device: OeeDeviceRow;
  mapping: OeeDeviceMappingRow | null;
  workCenterById: Map<string, OeeWorkCenterRow>;
  workCenterOptions: { value: string; label: string }[];
  /** This integration's mappings: work center → the device it holds. */
  deviceIdByWorkCenterId: Map<string, string>;
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const companyTimeZone = useCompanyTimeZone();
  const fetcher = useAction({
    onSuccess: () => toast.success(t`Saved device mapping`)
  });
  const isSaving = fetcher.state !== "idle";

  // While a save is in flight show the pick; afterwards the loader's mapping
  // is the truth, so a refused save falls back to what is stored.
  const pendingWorkCenterId = isSaving
    ? String(fetcher.formData?.get("workCenterId") ?? "")
    : null;
  const workCenterId = pendingWorkCenterId ?? mapping?.workCenterId ?? "";

  // The work center keeps time on its location's clock, else the company's.
  const workCenter = workCenterId ? workCenterById.get(workCenterId) : null;
  const locationTimezone = workCenter
    ? workCenter.locationTimezone || companyTimeZone
    : null;
  const siteTimezone = device.siteTimezone;
  const timezoneMismatch =
    siteTimezone !== null &&
    locationTimezone !== null &&
    siteTimezone !== locationTimezone;

  // A work center another device of this integration holds is refused on
  // save, so it is not offered; this row's own stays.
  const options = workCenterOptions.filter((option) => {
    const holder = deviceIdByWorkCenterId.get(option.value);
    return holder === undefined || holder === device.externalDeviceId;
  });

  const save = (nextWorkCenterId: string) => {
    if (nextWorkCenterId === (mapping?.workCenterId ?? "")) return;
    const formData = new FormData();
    formData.set("intent", "upsert-work-center-device");
    formData.set("externalDeviceId", device.externalDeviceId);
    formData.set("deviceName", device.name);
    formData.set("externalSiteId", device.externalSiteId ?? "");
    formData.set("siteTimezone", device.siteTimezone ?? "");
    formData.set("workCenterId", nextWorkCenterId);
    fetcher.submit(formData, { method: "post" });
  };

  const machine = [device.manufacturer, device.model].filter(Boolean).join(" ");

  return (
    <Tr className="border-b border-border last:border-b-0">
      <Td className="px-0 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <DeviceStatusDot mapping={mapping} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{device.name}</span>
            {(machine || device.calibrated === false) && (
              <span className="truncate text-xs text-muted-foreground">
                {machine}
                {machine && device.calibrated === false && " · "}
                {device.calibrated === false && <Trans>Not calibrated</Trans>}
              </span>
            )}
          </div>
        </div>
      </Td>
      <Td className="w-[240px] py-2.5 pl-3 pr-0">
        <div className="flex items-center justify-end gap-2">
          {timezoneMismatch && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0">
                  <LuTriangleAlert className="size-3.5 text-amber-500" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <Trans>
                  The device's site is in {siteTimezone}; Carbon uses{" "}
                  {locationTimezone}
                </Trans>
              </TooltipContent>
            </Tooltip>
          )}
          <div className="w-[200px] shrink-0">
            <Combobox
              size="sm"
              value={workCenterId}
              options={options}
              placeholder={t`Not mapped`}
              isClearable
              isLoading={isSaving}
              isReadOnly={!canUpdate}
              onChange={save}
            />
          </div>
        </div>
      </Td>
    </Tr>
  );
}

/** A status dot for the machine's state, with the details on hover. */
function DeviceStatusDot({ mapping }: { mapping: OeeDeviceMappingRow | null }) {
  const { t } = useLingui();
  const { formatTimeAgo } = useDateFormatter();

  const stateLabels = {
    Running: t`Running`,
    Idle: t`Idle`,
    Down: t`Down`,
    Offline: t`Offline`
  } as const;
  const stateDots = {
    Running: "bg-emerald-500",
    Idle: "bg-amber-400",
    Down: "bg-red-500",
    Offline: "bg-muted-foreground/40"
  } as const;

  let dotClassName = "border border-muted-foreground/40";
  // A plain string: it is both the tooltip and the trigger's aria-label.
  let labelText = t`Not mapped`;
  if (mapping?.lastSyncError) {
    dotClassName = "bg-red-500";
    labelText = mapping.lastSyncError;
  } else if (mapping?.currentState) {
    const state = stateLabels[mapping.currentState];
    dotClassName = stateDots[mapping.currentState];
    const syncedAgo = mapping.lastSyncedAt
      ? formatTimeAgo(mapping.lastSyncedAt)
      : null;
    labelText = syncedAgo ? t`${state} · synced ${syncedAgo}` : state;
  } else if (mapping) {
    dotClassName = "bg-muted-foreground/40";
    labelText = t`Waiting for the first sync`;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // focusable: the tooltip is the only place the state is shown
          tabIndex={0}
          role="img"
          aria-label={labelText}
          className="flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("size-2 rounded-full", dotClassName)} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{labelText}</TooltipContent>
    </Tooltip>
  );
}
