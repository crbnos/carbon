import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  SidebarTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { useMemo, useState } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import type { ColumnFilter } from "~/components/Filter";
import { ActiveFilters, Filter, useFilters } from "~/components/Filter";
import SearchFilter from "~/components/SearchFilter";
import { userContext } from "~/context";
import { useUrlParams } from "~/hooks";
import {
  getActiveMaintenanceDispatchesByLocation,
  getMaintenanceDispatchesAssignedTo
} from "~/services/maintenance.service";
import { maintenanceDispatchPriority } from "~/services/models";
import { getWorkCentersByLocation } from "~/services/operations.service";
import { path } from "~/utils/path";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const locationId = context.get(userContext)?.locationId;

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filterParam = searchParams.getAll("filter").filter(Boolean);

  let selectedWorkCenterIds: string[] = [];
  let selectedPriorities: string[] = [];
  let selectedStatuses: string[] = [];
  let selectedOeeImpacts: string[] = [];

  if (filterParam) {
    for (const filter of filterParam) {
      const [key, operator, value] = filter.split(":");
      if (key === "workCenterId") {
        if (operator === "in") {
          selectedWorkCenterIds = value.split(",");
        } else if (operator === "eq") {
          selectedWorkCenterIds = [value];
        }
      } else if (key === "priority") {
        if (operator === "in") {
          selectedPriorities = value.split(",");
        } else if (operator === "eq") {
          selectedPriorities = [value];
        }
      } else if (key === "status") {
        if (operator === "in") {
          selectedStatuses = value.split(",");
        } else if (operator === "eq") {
          selectedStatuses = [value];
        }
      } else if (key === "oeeImpact") {
        if (operator === "in") {
          selectedOeeImpacts = value.split(",");
        } else if (operator === "eq") {
          selectedOeeImpacts = [value];
        }
      }
    }
  }

  const [allDispatches, assignedDispatches, workCentersResult] =
    await Promise.all([
      getActiveMaintenanceDispatchesByLocation(client, locationId),
      getMaintenanceDispatchesAssignedTo(client, userId),
      getWorkCentersByLocation(client, locationId)
    ]);

  let filteredDispatches = allDispatches?.data ?? [];

  // Apply filters
  if (selectedWorkCenterIds.length) {
    filteredDispatches = filteredDispatches.filter((d) =>
      selectedWorkCenterIds.includes(d.workCenterId ?? "")
    );
  }

  if (selectedPriorities.length) {
    filteredDispatches = filteredDispatches.filter((d) =>
      selectedPriorities.includes(d.priority ?? "")
    );
  }

  if (selectedStatuses.length) {
    filteredDispatches = filteredDispatches.filter((d) =>
      selectedStatuses.includes(d.status ?? "")
    );
  }

  if (selectedOeeImpacts.length) {
    filteredDispatches = filteredDispatches.filter((d) =>
      selectedOeeImpacts.includes(d.oeeImpact ?? "")
    );
  }

  if (search) {
    const lowercasedSearch = search.toLowerCase();
    filteredDispatches = filteredDispatches.filter(
      (d) =>
        d.maintenanceDispatchId?.toLowerCase().includes(lowercasedSearch) ||
        d.workCenterName?.toLowerCase().includes(lowercasedSearch) ||
        d.severity?.toLowerCase().includes(lowercasedSearch) ||
        d.assigneeName?.toLowerCase().includes(lowercasedSearch)
    );
  }

  // Also filter assigned dispatches with the same criteria
  let filteredAssignedDispatches = assignedDispatches?.data ?? [];

  if (selectedWorkCenterIds.length) {
    filteredAssignedDispatches = filteredAssignedDispatches.filter((d) =>
      selectedWorkCenterIds.includes(d.workCenterId ?? "")
    );
  }

  if (selectedPriorities.length) {
    filteredAssignedDispatches = filteredAssignedDispatches.filter((d) =>
      selectedPriorities.includes(d.priority ?? "")
    );
  }

  if (selectedStatuses.length) {
    filteredAssignedDispatches = filteredAssignedDispatches.filter((d) =>
      selectedStatuses.includes(d.status ?? "")
    );
  }

  if (selectedOeeImpacts.length) {
    filteredAssignedDispatches = filteredAssignedDispatches.filter((d) =>
      selectedOeeImpacts.includes(d.oeeImpact ?? "")
    );
  }

  if (search) {
    const lowercasedSearch = search.toLowerCase();
    filteredAssignedDispatches = filteredAssignedDispatches.filter(
      (d) =>
        d.maintenanceDispatchId?.toLowerCase().includes(lowercasedSearch) ||
        d.workCenterName?.toLowerCase().includes(lowercasedSearch) ||
        d.severity?.toLowerCase().includes(lowercasedSearch) ||
        d.assigneeName?.toLowerCase().includes(lowercasedSearch)
    );
  }

  return {
    dispatches: filteredDispatches,
    assignedDispatches: filteredAssignedDispatches,
    locationId,
    workCenters: (workCentersResult?.data ?? []).map((wc) => ({
      value: wc.id,
      label: wc.name
    }))
  };
}

function getPriorityIcon(
  priority: (typeof maintenanceDispatchPriority)[number]
) {
  switch (priority) {
    case "Critical":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "High":
      return <HighPriorityIcon />;
    case "Medium":
      return <MediumPriorityIcon />;
    case "Low":
      return <LowPriorityIcon />;
  }
}

function getStatusColor(status: string | null) {
  switch (status) {
    case "Open":
      return "bg-blue-500";
    case "Assigned":
      return "bg-yellow-500";
    case "In Progress":
      return "bg-emerald-500";
    default:
      return "bg-gray-500";
  }
}

function getOeeImpactColor(oeeImpact: string) {
  switch (oeeImpact) {
    case "Down":
      return "destructive";
    case "Planned":
      return "secondary";
    case "Impact":
      return "outline";
    default:
      return "outline";
  }
}

type MaintenanceDispatch = NonNullable<
  Awaited<ReturnType<typeof loader>>["dispatches"]
>[number];

function MaintenanceCard({ dispatch }: { dispatch: MaintenanceDispatch }) {
  if (!dispatch.id) {
    return null;
  }
  return (
    <Link to={path.to.maintenanceDetail(dispatch.id)}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer p-0">
        <CardHeader className="pb-2">
          <HStack className="justify-between">
            <HStack spacing={2}>
              <span className="font-mono text-sm">
                {dispatch.maintenanceDispatchId}
              </span>
              <span
                className={`h-2 w-2 rounded-full ${getStatusColor(dispatch.status)}`}
              />
            </HStack>
            {getPriorityIcon(
              dispatch.priority as (typeof maintenanceDispatchPriority)[number]
            )}
          </HStack>
          <CardTitle className="text-base">{dispatch.workCenterName}</CardTitle>
          <CardDescription className="text-xs">
            {dispatch.severity}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HStack className="justify-between">
            <Badge
              variant={getOeeImpactColor(dispatch.oeeImpact ?? "No Impact")}
            >
              {dispatch.oeeImpact ?? "No Impact"}
            </Badge>
            {dispatch.assignee && (
              <EmployeeAvatar employeeId={dispatch.assignee} />
            )}
          </HStack>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyState({
  message,
  onClear
}: {
  message: string;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col flex-1 w-full h-[calc(100dvh-var(--header-height)*2-40px)] items-center justify-center gap-4">
      <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
        <LuTriangleAlert className="h-6 w-6" />
      </div>
      <span className="text-xs font-mono font-light text-foreground uppercase">
        {message}
      </span>
      {onClear && <Button onClick={onClear}>Clear Search</Button>}
    </div>
  );
}

function isToday(dateString: string | null): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

export default function MaintenanceRoute() {
  const { dispatches, assignedDispatches, workCenters } =
    useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");
  const [params] = useUrlParams();
  const { hasFilters, clearFilters } = useFilters();
  const currentFilters = params.getAll("filter").filter(Boolean);

  const blockingDispatches = useMemo(() => {
    return dispatches.filter((d) => {
      // Down is always blocking
      if (d.oeeImpact === "Down") return true;
      // Planned is only blocking if status is In Progress (active)
      if (d.oeeImpact === "Planned" && d.status === "In Progress") return true;
      return false;
    });
  }, [dispatches]);

  const todayDispatches = useMemo(() => {
    return dispatches.filter((d) => isToday(d.plannedStartTime));
  }, [dispatches]);

  const filters = useMemo<ColumnFilter[]>(() => {
    return [
      {
        accessorKey: "workCenterId",
        header: "Work Center",
        filter: {
          type: "static",
          options: workCenters
            .filter((wc) => wc.label !== null && wc.value !== null)
            .map((wc) => ({
              label: wc.label!,
              value: wc.value!
            }))
        }
      },
      {
        accessorKey: "priority",
        header: "Priority",
        filter: {
          type: "static",
          options: maintenanceDispatchPriority.map((p) => ({
            label: p,
            value: p
          }))
        }
      },
      {
        accessorKey: "status",
        header: "Status",
        pluralHeader: "Statuses",
        filter: {
          type: "static",
          options: [
            { label: "Open", value: "Open" },
            { label: "Assigned", value: "Assigned" },
            { label: "In Progress", value: "In Progress" }
          ]
        }
      },
      {
        accessorKey: "oeeImpact",
        header: "OEE Impact",
        filter: {
          type: "static",
          options: [
            { label: "Down", value: "Down" },
            { label: "Planned", value: "Planned" },
            { label: "Impact", value: "Impact" },
            { label: "No Impact", value: "No Impact" }
          ]
        }
      }
    ];
  }, [workCenters]);

  const getActiveDispatches = () => {
    switch (activeTab) {
      case "assigned":
        return assignedDispatches;
      case "blocking":
        return blockingDispatches;
      case "today":
        return todayDispatches;
      default:
        return dispatches;
    }
  };

  const activeDispatches = getActiveDispatches();

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">Maintenance</Heading>
        </div>
      </header>

      <main className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="w-full p-4">
          <VStack spacing={4}>
            <div className="w-full">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <HStack className="justify-between w-full">
                  <TabsList>
                    <TabsTrigger value="all">
                      All
                      {dispatches.length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {dispatches.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="today">
                      Today
                      {todayDispatches.length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {todayDispatches.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="assigned">
                      Assigned to Me
                      {assignedDispatches.length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {assignedDispatches.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="blocking">
                      Blocking
                      {blockingDispatches.length > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          {blockingDispatches.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                  <HStack spacing={2}>
                    <SearchFilter
                      param="search"
                      size="sm"
                      placeholder="Search"
                    />
                    <Filter filters={filters} />
                  </HStack>
                </HStack>
                {currentFilters.length > 0 && (
                  <HStack className="py-1.5 justify-between w-full">
                    <ActiveFilters filters={filters} />
                  </HStack>
                )}
                <TabsContent value="all" className="mt-4">
                  {activeDispatches.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
                      {activeDispatches.map((dispatch) => (
                        <MaintenanceCard
                          key={dispatch.id}
                          dispatch={dispatch}
                        />
                      ))}
                    </div>
                  ) : hasFilters ? (
                    <EmptyState
                      message="No results found"
                      onClear={clearFilters}
                    />
                  ) : (
                    <EmptyState message="No active maintenance dispatches" />
                  )}
                </TabsContent>
                <TabsContent value="today" className="mt-4">
                  {activeDispatches.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
                      {activeDispatches.map((dispatch) => (
                        <MaintenanceCard
                          key={dispatch.id}
                          dispatch={dispatch}
                        />
                      ))}
                    </div>
                  ) : hasFilters ? (
                    <EmptyState
                      message="No results found"
                      onClear={clearFilters}
                    />
                  ) : (
                    <EmptyState message="No maintenance scheduled for today" />
                  )}
                </TabsContent>
                <TabsContent value="assigned" className="mt-4">
                  {activeDispatches.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
                      {activeDispatches.map((dispatch) => (
                        <MaintenanceCard
                          key={dispatch.id}
                          dispatch={dispatch}
                        />
                      ))}
                    </div>
                  ) : hasFilters ? (
                    <EmptyState
                      message="No results found"
                      onClear={clearFilters}
                    />
                  ) : (
                    <EmptyState message="No dispatches assigned to you" />
                  )}
                </TabsContent>
                <TabsContent value="blocking" className="mt-4">
                  {activeDispatches.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
                      {activeDispatches.map((dispatch) => (
                        <MaintenanceCard
                          key={dispatch.id}
                          dispatch={dispatch}
                        />
                      ))}
                    </div>
                  ) : hasFilters ? (
                    <EmptyState
                      message="No results found"
                      onClear={clearFilters}
                    />
                  ) : (
                    <EmptyState message="No work centers are blocked" />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </VStack>
        </div>
      </main>
    </div>
  );
}
