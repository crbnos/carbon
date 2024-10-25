import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Button, HStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { LuListFilter } from "react-icons/lu";
import { SearchFilter } from "~/components";
import type { Column, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";
import { getActiveJobOperationsByLocation } from "~/modules/production";
import {
  getLocationsList,
  getWorkCentersByLocation,
} from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { makeDurations } from "~/utils/duration";

export const handle: Handle = {
  breadcrumb: "Schedule",
  to: path.to.schedule,
  module: "schedule",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.inventory,
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
        path.to.inventory,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const [workCenters, operations] = await Promise.all([
    getWorkCentersByLocation(client, locationId),
    getActiveJobOperationsByLocation(client, locationId),
  ]);

  return json({
    columns: (
      workCenters.data?.map((wc) => ({
        id: wc.id!,
        title: wc.name!,
        type:
          (wc.processes as { id: string; name: string }[] | undefined)?.map(
            (p) => p.id
          ) ?? [],
      })) ?? []
    ).sort((a, b) => a.title.localeCompare(b.title)) satisfies Column[],
    items: (operations.data?.map((op) => {
      const operation = makeDurations(op);
      return {
        id: op.id,
        columnId: op.workCenterId,
        columnType: op.processId,
        title: op.jobReadableId,
        subtitle: op.itemReadableId,
        description: op.description,
        dueDate: op.jobDueDate,
        duration:
          operation.setupDuration +
          Math.max(operation.laborDuration, operation.machineDuration),
        deadlineType: op.jobDeadlineType,
        customerId: op.jobCustomerId,
        status: op.operationStatus,
      };
    }) ?? []) satisfies Item[],
  });
}

export default function ScheduleRoute() {
  const { columns, items } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
        <HStack>
          <SearchFilter param="search" size="sm" placeholder="Search" />

          <Button
            rightIcon={<LuListFilter />}
            role="combobox"
            variant="secondary"
            className={"!border-dashed border-border"}
          >
            Filter
          </Button>
        </HStack>
      </HStack>
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
          <div className="flex flex-1 min-h-0 w-full relative">
            <Kanban
              columns={columns}
              items={items}
              showDescription
              showCustomer
              showEmployee
              showDueDate
              showDuration
              showProgress
              showStatus
            />
          </div>
        </div>
      </div>
    </div>
  );
}
