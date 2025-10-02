import { getCarbonServiceRole, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  ClientOnly,
  Heading,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SidebarTrigger,
  Spinner,
  Switch,
  toast,
  useInterval,
  useLocalStorage,
  useMount,
  VStack,
} from "@carbon/react";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned,
} from "@internationalized/date";
import { json, redirect, useLoaderData } from "@remix-run/react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuSettings2, LuTriangleAlert } from "react-icons/lu";

import type { ColumnFilter } from "~/components/Filter";
import { ActiveFilters, Filter, useFilters } from "~/components/Filter";
import type { Column, DisplaySettings, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";
import SearchFilter from "~/components/SearchFilter";
import { useUrlParams, useUser } from "~/hooks";
import { getLocation } from "~/services/location.server";
import { getFilters, setFilters } from "~/services/operation.server";
import {
  getActiveJobOperationsByLocation,
  getCustomers,
  getProcessesList,
  getWorkCentersByLocation,
} from "~/services/operations.service";
import { usePeople } from "~/stores";
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
    if (savedFilters && typeof savedFilters === "string") {
      const savedFiltersArray = savedFilters.split(",");
      const newUrl = new URL(request.url);
      newUrl.searchParams.delete("saved");
      savedFiltersArray.forEach((filter) => {
        newUrl.searchParams.append("filter", filter);
      });
      return redirect(newUrl.toString());
    } else if (filterParam.length === 0) {
      // No saved filters and no current filters, just remove the saved param
      const newUrl = new URL(request.url);
      newUrl.searchParams.delete("saved");
      return redirect(newUrl.toString());
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

  const customerIds = filteredOperations.map((op) => op.jobCustomerId);
  const customers = await getCustomers(serviceRole, companyId, customerIds);

  // Get unique tags and assignees for filters
  const availableTags = Array.from(
    new Set(filteredOperations.flatMap((op) => op.tags || []))
  ).sort();

  return json(
    {
      columns: filteredWorkCenters
        .map((wc) => ({
          id: wc.id!,
          title: wc.name!,
          type: wc.processes ?? [],
          active: activeWorkCenters.has(wc.id),
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
          dueDate: op.jobDueDate,
          duration:
            operation.setupDuration +
            Math.max(operation.laborDuration, operation.machineDuration),
          deadlineType: op.jobDeadlineType,
          customerId: op.jobCustomerId,
          operationQuantity: op.operationQuantity,
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
          quantityScrapped: op.quantityScrapped,
          setupDuration: operation.setupDuration,
          laborDuration: operation.laborDuration,
          machineDuration: operation.machineDuration,
        };
      }) ?? []) satisfies Item[],
      processes: processes.data ?? [],
      workCenters: workCenters.data ?? [],
      customers: customers.data ?? [],
      availableTags,
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
  showDuration: true,
  showCustomer: true,
  showDescription: true,
  showDueDate: true,
  showEmployee: true,
  showProgress: true,
  showStatus: true,
  showSalesOrder: true,
  showThumbnail: true,
};

const DISPLAY_SETTINGS_KEY = "kanban-schedule-display-settings";

function KanbanSchedule() {
  const {
    columns,
    items: initialItems,
    processes,
    workCenters,
    availableTags,
  } = useLoaderData<typeof loader>();
  const [items, setItems] = useState(initialItems);
  const [displaySettings, setDisplaySettings] = useLocalStorage(
    DISPLAY_SETTINGS_KEY,
    defaultDisplaySettings
  );

  const sortItems = useCallback((items: Item[]) => {
    return items.sort((a, b) => a.priority - b.priority);
  }, []);

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
      {
        accessorKey: "tag",
        header: "Tag",
        filter: {
          type: "static",
          options: availableTags.map((tag) => ({
            label: tag,
            value: tag,
          })),
        },
      },
      {
        accessorKey: "assignee",
        header: "Assignee",
        filter: {
          type: "static",
          options: people.map((person) => ({
            label: person.name,
            value: person.id,
          })),
        },
      },
    ];
  }, [processes, workCenters, availableTags, people]);

  return (
    <div className="flex flex-col h-screen w-[calc(100dvw-var(--sidebar-width-icon))]">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">Schedule</Heading>
        </div>
      </header>
      <div className="flex flex-col h-full max-h-full overflow-auto relative">
        <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
          <HStack>
            <SearchFilter param="search" size="sm" placeholder="Search" />
            <Filter filters={filters} />
          </HStack>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                leftIcon={<LuSettings2 />}
                variant="secondary"
                className="border-dashed border-border"
              >
                Display
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48">
              <VStack>
                {[
                  { key: "showCustomer", label: "Customer" },
                  { key: "showDescription", label: "Description" },
                  { key: "showDueDate", label: "Due Date" },
                  { key: "showDuration", label: "Duration" },
                  { key: "showProgress", label: "Progress" },
                  { key: "showStatus", label: "Status" },
                  { key: "showSalesOrder", label: "Sales Order" },
                  { key: "showThumbnail", label: "Thumbnail" },
                ].map(({ key, label }) => (
                  <Switch
                    key={key}
                    variant="small"
                    label={label}
                    checked={displaySettings[key as keyof DisplaySettings]}
                    onCheckedChange={(checked) =>
                      setDisplaySettings((prev) => ({
                        ...prev,
                        [key]: checked,
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
                columns={columns}
                items={items}
                {...displaySettings}
                showEmployee={false}
                progressByItemId={progressByOperation}
              />
            ) : hasFilters ? (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                  <LuTriangleAlert className="h-6 w-6" />
                </div>
                <span className="text-xs font-mono font-light text-foreground uppercase">
                  No results
                </span>
                <Button onClick={clearFilters}>Clear Filters</Button>
              </div>
            ) : (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                  <LuTriangleAlert className="h-6 w-6" />
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
    company: { id: companyId },
  } = useUser();
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
              event,
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
          employees,
        };
      }
    );

    return { progress };
  }, [productionEventsByOperation, items]);

  useInterval(() => {
    const { progress } = getProgress();

    setProgressByOperation(progress);
  }, 5000);

  useEffect(() => {
    if (Object.keys(productionEventsByOperation).length > 0) {
      const { progress } = getProgress();
      setProgressByOperation(progress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionEventsByOperation]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  useMount(() => {
    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel(`kanban-schedule:${companyId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=in.(${items.map((item) => item.id).join(",")})`,
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
                          priority: updated.priority,
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
            filter: `companyId=eq.${companyId}`,
          },
          (payload) => {
            if (payload.new) {
              const event = payload.new as Event;
              if (items.some((item) => item.id === event.jobOperationId)) {
                setProductionEventsByOperation((prev) => ({
                  ...prev,
                  [event.jobOperationId]: [
                    ...(prev[event.jobOperationId] ?? []),
                    event,
                  ],
                }));
              }
            } else if (payload.old) {
              const event = payload.old as Event;
              if (items.some((item) => item.id === event.jobOperationId)) {
                setProductionEventsByOperation((prev) => ({
                  ...prev,
                  [event.jobOperationId]: (
                    prev[event.jobOperationId] ?? []
                  ).filter((e) => e.id !== event.id),
                }));
              }
            }
          }
        )
        .subscribe();
    }
  });

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        carbon?.removeChannel(channelRef.current);
      }
    };
  }, [carbon]);

  return { progressByOperation };
}
