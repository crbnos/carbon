import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { ClientOnly, Spinner } from "@carbon/react";
import { json, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { LuAlertTriangle } from "react-icons/lu";
import type { Column, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";
import { getLocationAndWorkCenter } from "~/services/location.server";
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
  const filterParam = searchParams.getAll("filter");

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

  const { location } = await getLocationAndWorkCenter(request, serviceRole, {
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
        salesOrderReadableId: op.salesOrderReadableId,
        salesOrderId: op.salesOrderId,
        salesOrderLineId: op.salesOrderLineId,
        status: op.operationStatus,
      };
    }) ?? []) satisfies Item[],
    processes: processes.data ?? [],
    salesOrders: Object.entries(
      filteredOperations?.reduce((acc, op) => {
        if (op.salesOrderId) {
          acc[op.salesOrderId] = op.salesOrderReadableId;
        }
        return acc;
      }, {} as Record<string, string>) ?? {}
    ).map(([id, readableId]) => ({ id, readableId })),
  });
}

export default function Operations() {
  const { columns, items, processes } = useLoaderData<typeof loader>();
  const hasFilters = false; // TODO: implement filters

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <div className="flex flex-1 min-h-0 w-full relative">
          {columns.length > 0 ? (
            <ClientOnly
              fallback={
                <div className="flex h-full w-full items-center justify-center">
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
                  showEmployee
                  showProgress={false}
                  showStatus
                  showSalesOrder
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
              {/* <Button onClick={clearFilters}>Clear Filters</Button> */}
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
  );
}
