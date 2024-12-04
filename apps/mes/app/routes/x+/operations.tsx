import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  ClientOnly,
  Heading,
  HStack,
  SidebarTrigger,
  Spinner,
} from "@carbon/react";
import { json, redirect, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { useMemo } from "react";
import { LuAlertTriangle } from "react-icons/lu";

import type { ColumnFilter } from "~/components/Filter";
import { ActiveFilters, Filter, useFilters } from "~/components/Filter";
import type { Column, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";
import SearchFilter from "~/components/SearchFilter";
import { useUrlParams } from "~/hooks";
import { getLocation } from "~/services/location.server";
import { getFilters, setFilters } from "~/services/operation.server";
import {
  getActiveJobOperationsByLocation,
  getProcessesList,
  getWorkCentersByLocation,
} from "~/services/operations.service";
import { makeDurations } from "~/utils/durations";

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});
  const serviceRole = await getCarbonServiceRole();

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filterParam = searchParams.getAll("filter").filter(Boolean);
  const saved = searchParams.get("saved") === "1";

  // Handle saved filters
  const headers = new Headers();
  const savedFilters = await getFilters(request);

  if (saved) {
    if (savedFilters || filterParam.length === 0) {
      const savedFiltersArray = savedFilters?.split(",") ?? [];
      const newUrl = new URL(request.url);
      newUrl.searchParams.delete("saved");
      savedFiltersArray.forEach((filter) => {
        newUrl.searchParams.append("filter", filter);
      });
      return redirect(newUrl.toString());
    }
  } else {
    // Save current filters if they differ from saved ones
    const savedFilters = await getFilters(request);
    const currentFiltersString = filterParam?.filter(Boolean).join(",");
    if (savedFilters !== currentFiltersString) {
      headers.append(
        "Set-Cookie",
        await setFilters(request, currentFiltersString)
      );
      // Continue with the rest of the loader but include the cookie header
      // in the final response
    }
  }

  let selectedWorkCenterIds: string[] = [];
  let selectedProcessIds: string[] = [];
  let selectedSalesOrderIds: string[] = [];
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
      } else if (key === "salesOrderId") {
        if (operator === "in") {
          selectedSalesOrderIds = value.split(",");
        } else if (operator === "eq") {
          selectedSalesOrderIds = [value];
        }
      }
    }
  }

  const { location } = await getLocation(request, serviceRole, {
    companyId,
    userId,
  });

  const [workCenters, processes, operations] = await Promise.all([
    getWorkCentersByLocation(serviceRole, location),
    getProcessesList(serviceRole, companyId),
    getActiveJobOperationsByLocation(
      serviceRole,
      location,
      selectedWorkCenterIds
    ),
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

  if (selectedSalesOrderIds.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedSalesOrderIds.includes(op.salesOrderId)
    );
  }

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

  return json(
    {
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
          salesOrderReadableId: op.salesOrderReadableId,
          salesOrderId: op.salesOrderId,
          salesOrderLineId: op.salesOrderLineId,
          status: op.operationStatus,
        };
      }) ?? []) satisfies Item[],
      processes: processes.data ?? [],
      workCenters: workCenters.data ?? [],
    },
    { headers }
  );
}

export default function Operations() {
  const { columns, items, processes, workCenters } =
    useLoaderData<typeof loader>();

  const [params] = useUrlParams();
  const { hasFilters, clearFilters } = useFilters();
  const currentFilters = params.getAll("filter").filter(Boolean);
  const filters = useMemo<ColumnFilter[]>(() => {
    return [
      {
        accessorKey: "workCenterId",
        header: "Work Center",
        filter: {
          type: "static",
          options: workCenters.map((col) => ({
            label: col.name!,
            value: col.id!,
          })),
        },
      },
      {
        accessorKey: "processId",
        header: "Process",
        pluralHeader: "Processes",
        filter: {
          type: "static",
          options: processes
            .filter(
              (p): p is { id: string; name: string } =>
                p.id != null && p.name != null
            )
            .map((p) => ({
              label: p.name,
              value: p.id,
            })),
        },
      },
    ];
  }, [processes, workCenters]);

  return (
    <div className="flex flex-col h-full w-full">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">Schedule</Heading>
        </div>
      </header>
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
          <div className="flex flex-1 min-h-0 w-full relative">
            {columns.length > 0 ? (
              <ClientOnly
                fallback={
                  <div className="flex w-full h-full items-center justify-center">
                    <Spinner className="h-8 w-8" />
                  </div>
                }
              >
                {() => (
                  <Kanban
                    columns={columns}
                    items={items}
                    showCustomer
                    showDescription
                    showDueDate
                    showDuration
                    showEmployee={false}
                    showProgress={false}
                    showStatus
                    showSalesOrder={false}
                  />
                )}
              </ClientOnly>
            ) : hasFilters ? (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                  <LuAlertTriangle className="h-6 w-6" />
                </div>
                <span className="text-xs font-mono font-light text-foreground uppercase">
                  No results
                </span>
                <Button onClick={clearFilters}>Clear Filters</Button>
              </div>
            ) : (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                  <LuAlertTriangle className="h-6 w-6" />
                </div>
                <span className="text-xs font-mono font-light text-foreground uppercase">
                  No work centers exist
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
