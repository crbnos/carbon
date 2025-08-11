import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  ClientOnly,
  Combobox,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
import { Link, useLoaderData } from "@remix-run/react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCirclePlus, LuSettings2, LuTriangleAlert } from "react-icons/lu";
import { SearchFilter } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useUrlParams, useUser } from "~/hooks";
import { getActiveJobOperationsByLocation } from "~/modules/production";
import type { Column, Item } from "~/modules/production/ui/Schedule";

import type {
  DisplaySettings,
  Event,
  Progress,
} from "~/modules/production/ui/Schedule/Kanban";
import { Kanban } from "~/modules/production/ui/Schedule/Kanban";
import {
  getLocationsList,
  getProcessesList,
  getWorkCentersByLocation,
} from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import { getUserDefaults } from "~/modules/users/users.server";
import { usePeople } from "~/stores";
import { makeDurations } from "~/utils/duration";

export const handle: Handle = {
  breadcrumb: "Schedule",
  to: path.to.schedule,
  module: "schedule",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true,
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filterParam = searchParams.getAll("filter");

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

  const [workCenters, processes, operations, tags] = await Promise.all([
    getWorkCentersByLocation(client, locationId),
    getProcessesList(client, companyId),
    getActiveJobOperationsByLocation(client, locationId, selectedWorkCenterIds),
    getTagsList(client, companyId, "operation"),
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
    filteredOperations = filteredOperations.filter((op) => {
      if (op.tags) {
        return selectedTags.some((tag) => op.tags.includes(tag));
      }
      return false;
    });
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

  return json({
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
        columnId: op.workCenterId,
        columnType: op.processId,
        priority: op.priority,
        title: op.jobReadableId,
        link: op.parentMaterialId
          ? path.to.jobMakeMethod(op.jobId, op.jobMakeMethodId)
          : path.to.jobMethod(op.jobId, op.jobMakeMethodId),
        subtitle: op.itemReadableId,
        assignee: op.assignee,
        tags: op.tags,
        description: op.description,
        dueDate: op.jobDueDate,
        duration:
          operation.setupDuration +
          operation.laborDuration +
          operation.machineDuration,
        jobId: op.jobId,
        jobReadableId: op.jobReadableId,
        itemReadableId: op.itemReadableId,
        itemDescription: op.itemDescription,
        progress: 0,
        deadlineType: op.jobDeadlineType,
        customerId: op.jobCustomerId,
        quantity: op.operationQuantity,
        quantityCompleted: op.quantityComplete,
        quantityScrapped: op.quantityScrapped,
        salesOrderReadableId: op.salesOrderReadableId,
        salesOrderId: op.salesOrderId,
        salesOrderLineId: op.salesOrderLineId,
        status: op.operationStatus,
        setupDuration: operation.setupDuration,
        laborDuration: operation.laborDuration,
        machineDuration: operation.machineDuration,
        thumbnailPath: op.thumbnailPath,
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
    availableTags: Object.entries(
      filteredOperations.reduce((acc, op) => {
        if (op.tags) {
          op.tags.forEach((tag) => (acc[tag] = true));
        }
        return acc;
      }, {} as Record<string, boolean>)
    ).map(([tag]) => tag),
    tags: tags.data ?? [],
    locationId,
  });
}

const defaultDisplaySettings: DisplaySettings = {
  showDuration: true,
  showCustomer: true,
  showDescription: true,
  showDueDate: true,
  showEmployee: true,
  showProgress: true,
  showQuantity: true,
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
    salesOrders,
    availableTags,
    tags,
    locationId,
  } = useLoaderData<typeof loader>();

  const locations = useLocations();

  const [items, setItems] = useState<Item[]>(initialItems);
  const [displaySettings, setDisplaySettings] = useLocalStorage(
    DISPLAY_SETTINGS_KEY,
    defaultDisplaySettings
  );

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const sortItems = useCallback((items: Item[]) => {
    return [...items].sort((a, b) => a.priority - b.priority);
  }, []);

  useEffect(() => {
    setItems((prevItems) => sortItems(prevItems));
  }, [sortItems]);

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
          options: columns.map((col) => ({
            label: <Enumerable value={col.title} />,
            value: col.id,
          })),
        },
      },
      {
        accessorKey: "processId",
        header: "Process",
        pluralHeader: "Processes",
        filter: {
          type: "static",
          options: processes.map((p) => ({
            label: <Enumerable value={p.name} />,
            value: p.id,
          })),
        },
      },
      {
        accessorKey: "salesOrderId",
        header: "Sales Order",
        filter: {
          type: "static",
          options: salesOrders.map((so) => ({
            label: so.readableId,
            value: so.id,
          })),
        },
      },
      {
        accessorKey: "assignee",
        header: "Assignee",
        filter: {
          type: "static",
          options: people.map((p) => ({
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
    ];
  }, [columns, processes, salesOrders, people, availableTags]);

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
        <HStack>
          <SearchFilter param="search" size="sm" placeholder="Search" />
          <Filter filters={filters} />
        </HStack>

        <div className="flex items-center gap-2">
          <Combobox
            asButton
            size="sm"
            value={locationId}
            options={locations}
            onChange={(selected) => {
              // hard refresh because initialValues update has no effect otherwise
              window.location.href = getLocationPath(selected);
            }}
          />
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
                  { key: "showQuantity", label: "Quantity" },
                  { key: "showStatus", label: "Status" },
                  { key: "showSalesOrder", label: "Sales Order" },
                  { key: "showThumbnail", label: "Thumbnail" },
                ].map(({ key, label }) => (
                  <Switch
                    key={key}
                    variant="small"
                    label={label}
                    checked={
                      displaySettings[key as keyof typeof displaySettings]
                    }
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
        </div>
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
            <Kanban
              columns={columns}
              items={items}
              progressByItemId={progressByOperation}
              tags={tags}
              showCustomer={displaySettings.showCustomer}
              showDescription={displaySettings.showDescription}
              showDueDate={displaySettings.showDueDate}
              showDuration={displaySettings.showDuration}
              showEmployee={displaySettings.showEmployee}
              showProgress={displaySettings.showProgress}
              showQuantity={displaySettings.showQuantity}
              showStatus={displaySettings.showStatus}
              showSalesOrder={displaySettings.showSalesOrder}
              showThumbnail={displaySettings.showThumbnail}
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
              <Button leftIcon={<LuCirclePlus />} asChild>
                <Link to={path.to.newWorkCenter}>Create Work Center</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScheduleRoute() {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      {() => <KanbanSchedule />}
    </ClientOnly>
  );
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
            if (payload.eventType === "INSERT") {
              const { new: inserted } = payload;
              if (inserted.jobOperationId) {
                setProductionEventsByOperation((prevState) => ({
                  ...prevState,
                  [inserted.jobOperationId]: [
                    ...(prevState[inserted.jobOperationId] ?? []),
                    inserted,
                  ],
                }));
              }
            } else if (payload.eventType === "UPDATE") {
              const { new: updated } = payload;
              if (updated.jobOperationId) {
                setProductionEventsByOperation((prevState) => ({
                  ...prevState,
                  [updated.jobOperationId]: (
                    prevState[updated.jobOperationId] ?? []
                  ).map((event) => (event.id === updated.id ? updated : event)),
                }));
              }
            } else if (payload.eventType === "DELETE") {
              const { old: deleted } = payload;
              if (deleted.jobOperationId) {
                setProductionEventsByOperation((prevState) => ({
                  ...prevState,
                  [deleted.jobOperationId]: (
                    prevState[deleted.jobOperationId] ?? []
                  ).filter((event) => event.id !== deleted.id),
                }));
              }
            }
          }
        )
        .subscribe();
    }

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        carbon?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  });

  useEffect(() => {
    if (carbon && accessToken && channelRef.current)
      carbon.realtime.setAuth(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return { progressByOperation };
}

function getLocationPath(locationId: string) {
  return `${path.to.schedule}?location=${locationId}`;
}
