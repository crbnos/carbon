import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { HStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { useMemo } from "react";
import { SearchFilter } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useUrlParams } from "~/hooks";
import type { Column, Item } from "~/modules/production";
import { getActiveJobOperationsByLocation, Kanban } from "~/modules/production";
import {
  getLocationsList,
  getProcessesList,
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
  const filterParam = searchParams.getAll("filter");

  let selectedWorkCenterIds: string[] = [];
  let selectedProcessIds: string[] = [];
  if (filterParam) {
    for (const filter of filterParam) {
      const [key, operator, value] = filter.split(":");
      if (key === "workCenterId") {
        if (operator === "in") {
          selectedWorkCenterIds = value.split(",");
        } else if (operator === "eq") {
          selectedWorkCenterIds = [value];
        }
      } else if (key === "processId") {
        if (operator === "in") {
          selectedProcessIds = value.split(",");
        } else if (operator === "eq") {
          selectedProcessIds = [value];
        }
      }
    }
  }

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

  const [workCenters, processes, operations] = await Promise.all([
    getWorkCentersByLocation(client, locationId),
    getProcessesList(client, companyId),
    getActiveJobOperationsByLocation(client, locationId, selectedWorkCenterIds),
  ]);

  const activeWorkCenters = new Set();
  operations.data?.forEach((op) => {
    if (op.operationStatus === "In Progress") {
      activeWorkCenters.add(op.workCenterId);
    }
  });

  let filteredOperations = selectedWorkCenterIds.length
    ? operations.data?.filter((op) =>
        selectedWorkCenterIds.includes(op.workCenterId)
      ) ?? []
    : operations.data ?? [];

  if (search) {
    filteredOperations = filteredOperations.filter(
      (op) =>
        op.jobReadableId.toLowerCase().includes(search.toLowerCase()) ||
        op.itemReadableId.toLowerCase().includes(search.toLowerCase()) ||
        op.description?.toLowerCase().includes(search.toLowerCase())
    );
  }

  const filteredWorkCenters =
    workCenters.data?.filter((wc: any) => {
      if (selectedWorkCenterIds.length && selectedProcessIds.length) {
        return (
          selectedWorkCenterIds.includes(wc.id!) &&
          wc.processes?.some((p: { id: string }) =>
            selectedProcessIds.includes(p.id)
          )
        );
      } else if (selectedWorkCenterIds.length) {
        return selectedWorkCenterIds.includes(wc.id!);
      } else if (selectedProcessIds.length) {
        return wc.processes?.some((p: { id: string }) =>
          selectedProcessIds.includes(p.id)
        );
      }
      return true;
    }) ?? [];

  return json({
    columns: filteredWorkCenters
      .map((wc) => ({
        id: wc.id!,
        title: wc.name!,
        type:
          (wc.processes as { id: string; name: string }[] | undefined)?.map(
            (p) => p.id
          ) ?? [],
        active: activeWorkCenters.has(wc.id),
      }))
      .sort((a, b) => a.title.localeCompare(b.title)) satisfies Column[],
    items: (filteredOperations.map((op) => {
      const operation = makeDurations(op);
      return {
        id: op.id,
        columnId: op.workCenterId,
        columnType: op.processId,
        priority: op.priority,
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
    processes: processes.data ?? [],
  });
}

export default function ScheduleRoute() {
  const { columns, items, processes } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const currentFilters = params.getAll("filter");
  const filters = useMemo<ColumnFilter[]>(() => {
    return [
      {
        accessorKey: "workCenterId",
        header: "Work Center",
        filter: {
          type: "static",
          options: columns.map((col) => ({
            label: <Enumerable value={col.title} />,
            value: col.id,
          })),
        },
      },
      {
        accessorKey: "processId",
        header: "Process",
        filter: {
          type: "static",
          options: processes.map((p) => ({
            label: <Enumerable value={p.name} />,
            value: p.id,
          })),
        },
      },
    ];
  }, [columns, processes]);

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
        <HStack>
          <SearchFilter param="search" size="sm" placeholder="Search" />

          <Filter filters={filters} />
        </HStack>
      </HStack>
      {currentFilters.length > 0 && (
        <HStack className="px-4 py-1.5 justify-between bg-card border-b border-border w-full">
          <HStack>
            <ActiveFilters filters={filters} />
          </HStack>
        </HStack>
      )}
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
          <div className="flex flex-1 min-h-0 w-full relative">
            <Kanban
              columns={columns}
              items={items}
              showCustomer
              showDescription
              showDueDate
              showDuration
              showEmployee
              showProgress={false}
              showStatus
            />
          </div>
        </div>
      </div>
    </div>
  );
}
