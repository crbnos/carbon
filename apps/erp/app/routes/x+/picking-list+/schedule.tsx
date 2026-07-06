import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLocalStorage, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getPickingSchedule } from "~/modules/inventory";
import type {
  PickingDisplaySettings,
  PickingScheduleItem
} from "~/modules/inventory/ui/PickingLists";
import {
  defaultPickingDisplaySettings,
  PickingKanban,
  PickingListsHeader
} from "~/modules/inventory/ui/PickingLists";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { makeDurations } from "~/utils/duration";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Picking Lists`,
  to: path.to.pickingLists
};

const DISPLAY_SETTINGS_KEY = "picking-schedule-display-settings";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.pickingSchedule,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }
    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.authenticatedRoot,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data[0].id as string;
  }

  const pickingSchedule = await getPickingSchedule(client, {
    locationId,
    companyId,
    search
  });

  return {
    pickingSchedule: pickingSchedule.data ?? [],
    locationId
  };
}

export default function PickingScheduleRoute() {
  const { pickingSchedule, locationId } = useLoaderData<typeof loader>();

  const [displaySettings, setDisplaySettings] =
    useLocalStorage<PickingDisplaySettings>(
      DISPLAY_SETTINGS_KEY,
      defaultPickingDisplaySettings
    );

  const mergedDisplaySettings = useMemo(
    () => ({ ...defaultPickingDisplaySettings, ...displaySettings }),
    [displaySettings]
  );

  const data = useMemo<PickingScheduleItem[]>(
    () =>
      pickingSchedule.map((op) => ({
        ...op,
        duration: makeDurations({
          setupTime: op.setupTime ?? 0,
          setupUnit: op.setupUnit ?? undefined,
          laborTime: op.laborTime ?? 0,
          laborUnit: op.laborUnit ?? undefined,
          machineTime: op.machineTime ?? 0,
          machineUnit: op.machineUnit ?? undefined,
          operationQuantity: op.operationQuantity ?? 0
        }).duration
      })),
    [pickingSchedule]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <VStack spacing={0} className="h-full">
      <PickingListsHeader
        locationId={locationId}
        displaySettings={mergedDisplaySettings}
        onDisplaySettingChange={(key, value) =>
          setDisplaySettings((prev) => ({
            ...defaultPickingDisplaySettings,
            ...prev,
            [key]: value
          }))
        }
        selectedJobOperationIds={Array.from(selectedIds)}
      />
      <PickingKanban
        data={data}
        displaySettings={mergedDisplaySettings}
        selectedIds={selectedIds}
        onToggle={toggleSelection}
      />
      <Outlet />
    </VStack>
  );
}
