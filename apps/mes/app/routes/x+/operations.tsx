import { useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Button,
  ClientOnly,
  Heading,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  SidebarTrigger,
  Spinner,
  Switch,
  toast,
  useInterval,
  useLocalStorage,
  useMount,
  useRealtimeChannel,
  VStack
} from "@carbon/react";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuSettings2, LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";

import type { ColumnFilter } from "~/components/Filter";
import { ActiveFilters, Filter, useFilters } from "~/components/Filter";
import type { Column, DisplaySettings, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";
import SearchFilter from "~/components/SearchFilter";
import { userContext } from "~/context";
import { useUrlParams, useUser } from "~/hooks";
import { getFilters, setFilters } from "~/services/operation.server";
import {
  getActiveJobOperationsByLocation,
  getCustomers,
  getProcessesList,
  getWorkCentersByLocation
} from "~/services/operations.service";
import { usePeople } from "~/stores";
import { makeDurations } from "~/utils/durations";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filterParam = searchParams.getAll("filter").filter(Boolean);
  const saved = searchParams.get("saved") === "1";

  // Handle saved filters
  const headers = new Headers();
  const savedFilters = await getFilters(request);

  if (saved) {
    if (savedFilters && typeof savedFilters === "string") {
      const savedFiltersArray = savedFilters.split(",");
      const newUrl = new URL(request.url);
      newUrl.searchParams.delete("saved");
      savedFiltersArray.forEach((filter) => {
        newUrl.searchParams.append("filter", filter);
      });
      return redirect(`${newUrl.pathname}${newUrl.search}`);
    } else if (filterParam.length === 0) {
      // No saved filters and no current filters, just remove the saved param
      const newUrl = new URL(request.url);
      newUrl.searchParams.delete("saved");
      return redirect(`${newUrl.pathname}${newUrl.search}`);
    }
  } else {
    // Save current filters if they differ from saved ones
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
  let selectedTags: string[] = [];
  let selectedAssignee: string[] = [];

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
      } else if (key === "tag") {
        if (operator === "in") {
          selectedTags = value.split(",");
        } else if (operator === "eq") {
          selectedTags = [value];
        }
      } else if (key === "assignee") {
        if (operator === "in") {
          selectedAssignee = value.split(",");
        } else if (operator === "eq") {
          selectedAssignee = [value];
        }
      }
    }
  }

  const locationId = context.get(userContext)?.locationId;

  const [workCenters, processes, operations] = await Promise.all([
    getWorkCentersByLocation(serviceRole, locationId),
    getProcessesList(serviceRole, companyId),
    getActiveJobOperationsByLocation(
      serviceRole,
      locationId,
      selectedWorkCenterIds
    )
  ]);

  if (operations.error) {
    console.error(operations.error);
  }

  const activeWorkCenters = new Set();
  operations.data?.forEach((op) => {
    if (op.operationStatus === "In Progress") {
      activeWorkCenters.add(op.workCenterId);
    }
  });

  let filteredOperations = selectedWorkCenterIds.length
    ? (operations.data?.filter((op) =>
        selectedWorkCenterIds.includes(op.workCenterId)
      ) ?? [])
    : (operations.data ?? []);

  if (selectedSalesOrderIds.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedSalesOrderIds.includes(op.salesOrderId)
    );
  }

  if (selectedTags.length) {
    filteredOperations = filteredOperations.filter((op) =>
      op.tags?.some((tag) => selectedTags.includes(tag))
    );
  }

  if (selectedAssignee.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedAssignee.includes(op.assignee)
    );
  }

  if (selectedProcessIds.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedProcessIds.includes(op.processId)
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
          wc.processes?.some((p: string) => selectedProcessIds.includes(p))
        );
      } else if (selectedWorkCenterIds.length) {
        return selectedWorkCenterIds.includes(wc.id!);
      } else if (selectedProcessIds.length) {
        return wc.processes?.some((p: string) =>
          selectedProcessIds.includes(p)
        );
      }
      return true;
    }) ?? [];

  const customerIds = filteredOperations.map((op) => op.jobCustomerId);
  const customers = await getCustomers(serviceRole, companyId, customerIds);

  // Get unique tags and assignees for filters
  const availableTags = Array.from(
    new Set(filteredOperations.flatMap((op) => op.tags || []))
  ).sort();

  return data(
    {
      columns: filteredWorkCenters
        .map((wc: any) => ({
          id: wc.id!,
          title: wc.name!,
          type: wc.processes ?? [],
          active: activeWorkCenters.has(wc.id),
          isBlocked: wc.isBlocked ?? false,
          blockingDispatchId: wc.blockingDispatchId ?? undefined,
          blockingDispatchReadableId: wc.blockingDispatchReadableId ?? undefined
        }))
        .sort((a, b) => a.title.localeCompare(b.title)) satisfies Column[],
      items: (filteredOperations.map((op) => {
        const operation = makeDurations(op);
        return {
          id: op.id,
          assignee: op.assignee,
          tags: op.tags,
          columnId: op.workCenterId,
          columnType: op.processId,
          priority: op.priority,
          title: op.jobReadableId,
          subtitle: op.itemReadableId,
          description: op.description,
          dueDate: op.operationDueDate,
          duration:
            operation.setupDuration +
            Math.max(operation.laborDuration, operation.machineDuration),
          deadlineType: op.jobDeadlineType,
          customerId: op.jobCustomerId,
          operationQuantity: op.operationQuantity,
          targetQuantity: op.targetQuantity ?? op.operationQuantity,
          jobReadableId: op.jobReadableId,
          itemReadableId: op.itemReadableId,
          itemDescription: op.itemDescription,
          salesOrderReadableId: op.salesOrderReadableId,
          salesOrderId: op.salesOrderId,
          salesOrderLineId: op.salesOrderLineId,
          status: op.operationStatus,
          thumbnailPath: op.thumbnailPath,
          quantity: op.operationQuantity,
          quantityCompleted: op.quantityComplete,
          quantityReworked: op.quantityReworked,
          quantityScrapped: op.quantityScrapped,
          reworkId: op.reworkId,
          setupDuration: operation.setupDuration,
          laborDuration: operation.laborDuration,
          machineDuration: operation.machineDuration
        };
      }) ?? []) satisfies Item[],
      processes: processes.data ?? [],
      workCenters: workCenters.data ?? [],
      customers: customers.data ?? [],
      availableTags
    },
    { headers }
  );
}

export default function ScheduleRoute() {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-screen w-[calc(100dvw-var(--sidebar-width-icon))] items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      {() => <KanbanSchedule />}
    </ClientOnly>
  );
}

const defaultDisplaySettings: DisplaySettings = {
  emptyWorkCenters: true,
  showDuration: true,
  showCustomer: true,
  showDescription: true,
  showDueDate: true,
  showEmployee: true,
  showProgress: true,
  showStatus: true,
  showSalesOrder: true,
  showThumbnail: true
};

const DISPLAY_SETTINGS_KEY = "kanban-schedule-display-settings";

function KanbanSchedule() {
  const { t } = useLingui();
  const {
    columns,
    items: initialItems,
    processes,
    workCenters,
    availableTags
  } = useLoaderData<typeof loader>();
  const [items, setItems] = useState<Item[]>(initialItems);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const [displaySettings, setDisplaySettings] = useLocalStorage(
    DISPLAY_SETTINGS_KEY,
    defaultDisplaySettings
  );
  const mergedDisplaySettings = useMemo(
    () => ({ ...defaultDisplaySettings, ...displaySettings }),
    [displaySettings]
  );

  const sortItems = useCallback((items: Item[]) => {
    return items.sort((a, b) => a.priority - b.priority);
  }, []);

  const visibleColumns = useMemo(() => {
    if (mergedDisplaySettings.emptyWorkCenters) {
      return columns;
    }

    const workCenterIdsWithOperations = new Set(
      items.map((item) => item.columnId)
    );
    return columns.filter((column) =>
      workCenterIdsWithOperations.has(column.id)
    );
  }, [columns, items, mergedDisplaySettings.emptyWorkCenters]);

  const { progressByOperation } = useProgressByOperation(
    items,
    setItems,
    sortItems
  );

  const [people] = usePeople();
  const [params] = useUrlParams();
  const { hasFilters, clearFilters } = useFilters();
  const currentFilters = params.getAll("filter").filter(Boolean);
  const filters = useMemo<ColumnFilter[]>(() => {
    return [
      {
        accessorKey: "workCenterId",
        header: t`Work Center`,
        filter: {
          type: "static",
          options: workCenters.map((col) => ({
            label: col.name!,
            value: col.id!
          }))
        }
      },
      {
        accessorKey: "processId",
        header: t`Process`,
        pluralHeader: t`Processes`,
        filter: {
          type: "static",
          options: processes
            .filter(
              (p): p is { id: string; name: string } =>
                p.id != null && p.name != null
            )
            .map((p) => ({
              label: p.name,
              value: p.id
            }))
        }
      },
      {
        accessorKey: "tag",
        header: t`Tag`,
        filter: {
          type: "static",
          options: availableTags.map((tag) => ({
            label: tag,
            value: tag
          }))
        }
      },
      {
        accessorKey: "assignee",
        header: t`Assignee`,
        filter: {
          type: "static",
          options: people.map((person) => ({
            label: person.name,
            value: person.id
          }))
        }
      }
    ];
  }, [processes, workCenters, availableTags, people, t]);

  return (
    <div className="flex flex-col h-screen w-[calc(100dvw-var(--sidebar-width-icon))]">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">
            <Trans>Schedule</Trans>
          </Heading>
        </div>
      </header>
      <div className="flex flex-col h-full max-h-full overflow-auto relative">
        <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
          <HStack>
            <SearchFilter param="search" size="sm" placeholder={t`Search`} />
            <Filter filters={filters} />
          </HStack>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                leftIcon={<LuSettings2 />}
                variant="secondary"
                className="border-dashed border-border"
              >
                <Trans>Display</Trans>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56">
              <VStack>
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Columns</Trans>
                </span>
                {[
                  { key: "emptyWorkCenters", label: t`Empty work centers` }
                ].map(({ key, label }) => (
                  <Switch
                    key={key}
                    variant="small"
                    label={label}
                    checked={
                      mergedDisplaySettings[key as keyof DisplaySettings]
                    }
                    onCheckedChange={(checked) =>
                      setDisplaySettings((prev) => ({
                        ...defaultDisplaySettings,
                        ...prev,
                        [key]: checked
                      }))
                    }
                  />
                ))}
                <Separator />
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Cards</Trans>
                </span>
                {[
                  { key: "showCustomer", label: t`Customer` },
                  { key: "showDescription", label: t`Description` },
                  { key: "showDueDate", label: t`Due Date` },
                  { key: "showDuration", label: t`Duration` },
                  { key: "showProgress", label: t`Progress` },
                  { key: "showStatus", label: t`Status` },
                  { key: "showSalesOrder", label: t`Sales Order` },
                  { key: "showThumbnail", label: t`Thumbnail` }
                ].map(({ key, label }) => (
                  <Switch
                    key={key}
                    variant="small"
                    label={label}
                    checked={
                      mergedDisplaySettings[key as keyof DisplaySettings]
                    }
                    onCheckedChange={(checked) =>
                      setDisplaySettings((prev) => ({
                        ...defaultDisplaySettings,
                        ...prev,
                        [key]: checked
                      }))
                    }
                  />
                ))}
              </VStack>
            </PopoverContent>
          </Popover>
        </HStack>
        {currentFilters.length > 0 && (
          <HStack className="px-4 py-1.5 justify-between bg-card border-b border-border w-full">
            <HStack>
              <ActiveFilters filters={filters} />
            </HStack>
          </HStack>
        )}
        <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
          <div className="flex flex-1 min-h-full w-full relative">
            {columns.length > 0 ? (
              <Kanban
                columns={visibleColumns}
                items={items}
                {...mergedDisplaySettings}
                showEmployee={false}
                progressByItemId={progressByOperation}
              />
            ) : hasFilters ? (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                  <LuTriangleAlert className="h-6 w-6" />
                </div>
                <span className="text-xs font-mono font-light text-foreground uppercase">
                  <Trans>No results</Trans>
                </span>
                <Button onClick={clearFilters}>
                  <Trans>Clear Filters</Trans>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                  <LuTriangleAlert className="h-6 w-6" />
                </div>
                <span className="text-xs font-mono font-light text-foreground uppercase">
                  <Trans>No work centers exist</Trans>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface Event {
  id: string;
  jobOperationId: string;
  duration: number | null;
  startTime: string | null;
  endTime: string | null;
  employeeId: string | null;
}

interface Progress {
  totalDuration: number;
  progress: number;
  active: boolean;
  employees?: Set<string>;
}

function useProgressByOperation(
  items: Item[],
  setItems: React.Dispatch<React.SetStateAction<Item[]>>,
  sortItems: (items: Item[]) => Item[]
) {
  const {
    company: { id: companyId }
  } = useUser();
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { carbon, accessToken } = useCarbon();

  const [productionEventsByOperation, setProductionEventsByOperation] =
    useState<Record<string, Event[]>>({});

  const [progressByOperation, setProgressByOperation] = useState<
    Record<string, Progress>
  >({});

  const getProductionEvents = useCallback(
    async (operationIds: string[]) => {
      if (!carbon) return;

      const { data, error } = await carbon
        .from("productionEvent")
        .select(
          "id, jobOperationId, duration, startTime, endTime, duration, employeeId"
        )
        .eq("companyId", companyId)
        .in("jobOperationId", operationIds);

      if (error) {
        toast.error(error.message);
      }

      if (data) {
        setProductionEventsByOperation(
          data.reduce<Record<string, Event[]>>((acc, event) => {
            acc[event.jobOperationId] = [
              ...(acc[event.jobOperationId] ?? []),
              event
            ];
            return acc;
          }, {})
        );
      }
    },
    [carbon, companyId]
  );

  useMount(() => {
    getProductionEvents(items.map((item) => item.id));
  });

  const getProgress = useCallback(() => {
    const timeNow = now(getLocalTimeZone());
    const progress: Record<string, Progress> = {};

    Object.entries(productionEventsByOperation).forEach(
      ([operationId, events]) => {
        const operation = items.find((item) => item.id === operationId);
        const totalDuration =
          (operation?.setupDuration ?? 0) +
          (operation?.laborDuration ?? 0) +
          (operation?.machineDuration ?? 0);

        let currentProgress = 0;
        let active = false;
        let employees: Set<string> = new Set();
        events.forEach((event) => {
          if (event.endTime && event.duration) {
            currentProgress += event.duration * 1000;
          } else if (event.startTime) {
            active = true;

            if (event.employeeId) {
              employees.add(event.employeeId);
            }

            const startTime = toZoned(
              parseAbsolute(event.startTime, getLocalTimeZone()),
              getLocalTimeZone()
            );

            const difference = timeNow.compare(startTime);
            if (difference > 0) {
              currentProgress += difference;
            }
          }
        });

        progress[operationId] = {
          totalDuration,
          progress: currentProgress,
          active,
          employees
        };
      }
    );

    return { progress };
  }, [productionEventsByOperation, items]);

  useInterval(() => {
    const { progress } = getProgress();

    setProgressByOperation(progress);
  }, 5000);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (Object.keys(productionEventsByOperation).length > 0) {
      const { progress } = getProgress();
      setProgressByOperation(progress);
    }
  }, [productionEventsByOperation]);

  useRealtimeChannel({
    topic: `kanban-schedule:${companyId}`,
    dependencies: [items.length],
    setup(channel) {
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=in.(${items.map((item) => item.id).join(",")})`
          },
          (payload) => {
            switch (payload.eventType) {
              case "UPDATE": {
                const { new: updated } = payload;
                setItems((prevItems: Item[]) =>
                  sortItems(
                    prevItems.map((item: Item) => {
                      if (item.id === updated.id) {
                        return {
                          ...item,
                          columnId: updated.workCenterId,
                          priority: updated.priority
                        };
                      }
                      return item;
                    })
                  )
                );
                break;
              }
              case "DELETE": {
                const { old: deleted } = payload;
                setItems((prevItems: Item[]) =>
                  sortItems(
                    prevItems.filter((item: Item) => item.id !== deleted.id)
                  )
                );
                break;
              }
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `companyId=eq.${companyId}`
          },
          (payload) => {
            if (payload.new) {
              const event = payload.new as Event;
              if (items.some((item) => item.id === event.jobOperationId)) {
                setProductionEventsByOperation((prev) => ({
                  ...prev,
                  [event.jobOperationId]: [
                    ...(prev[event.jobOperationId] ?? []),
                    event
                  ]
                }));
              }
            } else if (payload.old) {
              const event = payload.old as Event;
              if (items.some((item) => item.id === event.jobOperationId)) {
                setProductionEventsByOperation((prev) => ({
                  ...prev,
                  [event.jobOperationId]: (
                    prev[event.jobOperationId] ?? []
                  ).filter((e) => e.id !== event.id)
                }));
              }
            }
          }
        );
    }
  });

  return { progressByOperation };
}
