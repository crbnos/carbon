// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import {
  Button,
  CarbonPulse,
  ClientOnly,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  useLocalStorage,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuKanban,
  LuList,
  LuSearch,
  LuSettings2,
  LuTriangleAlert
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { OperationsList } from "~/components";
import type { Column, DisplaySettings, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { userContext } from "~/context";
import {
  getJobOperationsAssignedToEmployee,
  getWorkCentersByCompany
} from "~/services/operations.service";
import { makeDurations } from "~/utils/durations";
import type { Handle } from "~/utils/handle";

export const handle: Handle = {
  realtime: ["jobOperation", "productionEvent"]
};

const log = getLogger("mes");

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});

  const serviceRole = getCarbonServiceRole();
  const locationId = context.get(userContext)?.locationId;

  const [operations, workCenters] = await Promise.all([
    getJobOperationsAssignedToEmployee(serviceRole, userId, companyId),
    getWorkCentersByCompany(serviceRole, companyId)
  ]);

  if (operations.error) {
    log.error("Failed to load assigned operations", {
      error: operations.error
    });
  }

  if (workCenters.error) {
    log.error("Failed to load work centers", { error: workCenters.error });
  }

  return {
    operations: operations?.data?.map(makeDurations) ?? [],
    workCenters: workCenters?.data ?? [],
    locationId
  };
}

type AssignedView = "board" | "list";

const ASSIGNED_VIEW_KEY = "assigned-view";
const DISPLAY_SETTINGS_KEY = "kanban-assigned-display-settings";
const UNASSIGNED_COLUMN_ID = "unassigned";

const defaultDisplaySettings: DisplaySettings = {
  emptyWorkCenters: false,
  showCustomer: false,
  showDescription: true,
  showDueDate: true,
  showDuration: true,
  showEmployee: false,
  showProgress: false,
  showStatus: true,
  showSalesOrder: true,
  showThumbnail: true
};

export default function AssignedRoute() {
  const { t } = useLingui();
  const { operations, workCenters, locationId } =
    useLoaderData<typeof loader>();
  const [searchTerm, setSearchTerm] = useState("");
  const [view, setView] = useLocalStorage<AssignedView>(
    ASSIGNED_VIEW_KEY,
    "board"
  );
  const [displaySettings, setDisplaySettings] = useLocalStorage(
    DISPLAY_SETTINGS_KEY,
    defaultDisplaySettings
  );
  const mergedDisplaySettings = useMemo(
    () => ({ ...defaultDisplaySettings, ...displaySettings }),
    [displaySettings]
  );

  const filteredOperations = useMemo(() => {
    if (!searchTerm) return operations;
    const lowercasedTerm = searchTerm.toLowerCase();
    return operations.filter(
      (operation) =>
        operation.description?.toLowerCase().includes(lowercasedTerm) ||
        operation.jobReadableId?.toLowerCase().includes(lowercasedTerm) ||
        operation.itemReadableId?.toLowerCase().includes(lowercasedTerm) ||
        operation.itemDescription?.toLowerCase().includes(lowercasedTerm)
    );
  }, [operations, searchTerm]);

  const { columns, items } = useMemo(() => {
    const activeWorkCenterIds = new Set<string>();
    const columnWorkCenterIds = new Set<string>();
    let hasUnassignedOperations = false;
    let hasActiveUnassignedOperations = false;

    for (const operation of filteredOperations) {
      const isActive = operation.operationStatus === "In Progress";
      if (operation.workCenterId) {
        columnWorkCenterIds.add(operation.workCenterId);
        if (isActive) {
          activeWorkCenterIds.add(operation.workCenterId);
        }
      } else {
        hasUnassignedOperations = true;
        if (isActive) {
          hasActiveUnassignedOperations = true;
        }
      }
    }

    // By default only work centers with assigned operations become columns;
    // the display setting adds the rest of the current location's work centers.
    if (mergedDisplaySettings.emptyWorkCenters) {
      for (const workCenter of workCenters) {
        if (workCenter.id && workCenter.locationId === locationId) {
          columnWorkCenterIds.add(workCenter.id);
        }
      }
    }

    const columns: Column[] = Array.from(columnWorkCenterIds)
      .map((workCenterId) => {
        const workCenter = workCenters.find((wc) => wc.id === workCenterId);
        return {
          id: workCenterId,
          title: workCenter?.name ?? "",
          type: workCenter?.processes ?? [],
          active: activeWorkCenterIds.has(workCenterId),
          isBlocked: workCenter?.isBlocked ?? false,
          blockingDispatchId: workCenter?.blockingDispatchId ?? undefined,
          blockingDispatchReadableId:
            workCenter?.blockingDispatchReadableId ?? undefined
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    if (hasUnassignedOperations) {
      columns.push({
        id: UNASSIGNED_COLUMN_ID,
        title: t`No Work Center`,
        type: [],
        active: hasActiveUnassignedOperations
      });
    }

    const items = filteredOperations.map((operation, index) => ({
      id: operation.id,
      assignee: operation.assignee,
      tags: operation.tags,
      columnId: operation.workCenterId ?? UNASSIGNED_COLUMN_ID,
      columnType: operation.processId,
      // the RPC orders by priority but does not return it
      priority: index,
      title: operation.jobReadableId,
      subtitle: operation.itemReadableId,
      description: operation.description,
      dueDate: operation.operationDueDate,
      duration:
        operation.setupDuration +
        Math.max(operation.laborDuration, operation.machineDuration),
      deadlineType: operation.jobDeadlineType,
      customerId: operation.jobCustomerId,
      operationQuantity: operation.operationQuantity,
      targetQuantity: operation.targetQuantity ?? operation.operationQuantity,
      jobReadableId: operation.jobReadableId,
      itemReadableId: operation.itemReadableId,
      itemDescription: operation.itemDescription,
      salesOrderReadableId: operation.salesOrderReadableId,
      salesOrderId: operation.salesOrderId,
      salesOrderLineId: operation.salesOrderLineId,
      status: operation.operationStatus,
      thumbnailPath: operation.thumbnailPath,
      quantity: operation.operationQuantity,
      quantityCompleted: operation.quantityComplete,
      quantityScrapped: operation.quantityScrapped,
      setupDuration: operation.setupDuration,
      laborDuration: operation.laborDuration,
      machineDuration: operation.machineDuration
    })) satisfies Item[];

    return { columns, items };
  }, [
    filteredOperations,
    workCenters,
    mergedDisplaySettings.emptyWorkCenters,
    locationId,
    t
  ]);

  // With "Empty work centers" on, an empty board of location columns is
  // still worth showing — but a search with no matches keeps its empty state.
  const showEmptyBoard =
    view === "board" &&
    mergedDisplaySettings.emptyWorkCenters &&
    !searchTerm &&
    columns.length > 0;

  const displayPopoverContent = (
    <PopoverContent className="w-56">
      <VStack>
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Columns</Trans>
        </span>
        {[
          {
            key: "emptyWorkCenters",
            label: t`Empty work centers`
          }
        ].map(({ key, label }) => (
          <Switch
            key={key}
            variant="small"
            label={label}
            checked={mergedDisplaySettings[key as keyof DisplaySettings]}
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
            checked={mergedDisplaySettings[key as keyof DisplaySettings]}
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
  );

  return (
    // Phones: the page takes the screen above the tab bar, so the list and
    // the board scroll inside it (see Schedule).
    <div className="flex flex-col flex-1 min-h-0 min-w-0 max-md:h-[calc(100dvh-var(--mes-tab-bar-h))] max-md:flex-none">
      <MesAppBar
        title={<Trans>Assigned</Trans>}
        actions={
          <>
            {view === "board" && (
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton
                    aria-label={t`Display`}
                    variant="ghost"
                    size="lg"
                    icon={<LuSettings2 />}
                  />
                </PopoverTrigger>
                {displayPopoverContent}
              </Popover>
            )}
            <IconButton
              aria-label={view === "board" ? t`List view` : t`Board view`}
              variant="ghost"
              size="lg"
              icon={view === "board" ? <LuList /> : <LuKanban />}
              onClick={() => setView(view === "board" ? "list" : "board")}
            />
          </>
        }
      />
      <MesQueueHeader
        title={<Trans>Assigned to Me</Trans>}
        className="overflow-y-scroll scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent"
      />

      {/* Phones: a column so the board fills what the toolbar leaves and
          each column scrolls under its header (see Schedule). */}
      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent max-md:flex max-md:flex-col">
        <div className="w-full px-4 h-[var(--header-height)] flex items-center max-md:h-auto max-md:pt-3">
          <div className="relative w-full">
            <div className="flex justify-between gap-4">
              <div className="flex flex-grow min-w-0">
                <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t`Search`}
                  className="pl-8"
                />
              </div>
              <div className="flex items-center gap-2 max-md:hidden">
                {view === "board" && (
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
                    {displayPopoverContent}
                  </Popover>
                )}
                <ToggleGroup
                  type="single"
                  value={view}
                  onValueChange={(value) => {
                    if (value) setView(value as AssignedView);
                  }}
                >
                  <ToggleGroupItem value="board" aria-label={t`Board view`}>
                    <LuKanban />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label={t`List view`}>
                    <LuList />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>
        </div>

        {filteredOperations.length > 0 || showEmptyBoard ? (
          view === "board" ? (
            <ClientOnly
              fallback={
                <div className="flex w-full h-[calc(100%-var(--header-height))] items-center justify-center">
                  <CarbonPulse />
                </div>
              }
            >
              {() => (
                <div className="flex flex-grow items-stretch overflow-hidden relative max-md:min-h-0">
                  <div className="flex flex-1 min-h-full w-full relative">
                    <Kanban
                      columns={columns}
                      items={items}
                      {...mergedDisplaySettings}
                    />
                  </div>
                </div>
              )}
            </ClientOnly>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4">
              <OperationsList operations={filteredOperations} />
            </div>
          )
        ) : searchTerm ? (
          <div className="flex flex-col flex-1 w-full h-[calc(100%-var(--header-height)*2)] items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuTriangleAlert className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              <Trans>No results exist</Trans>
            </span>
            <Button onClick={() => setSearchTerm("")}>
              <Trans>Clear Search</Trans>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col flex-1 w-full h-[calc(100%-var(--header-height)*2)] items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuTriangleAlert className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              <Trans>No assigned operations</Trans>
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
