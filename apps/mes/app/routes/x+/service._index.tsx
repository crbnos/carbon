// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import { datetime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import type { ColumnFilter } from "~/components/Filter";
import { ActiveFilters, Filter, useFilters } from "~/components/Filter";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import SearchFilter from "~/components/SearchFilter";
import {
  CoverageBadge,
  NewServiceJobModal,
  ServiceJobStatus,
  useCoverageLabels,
  useServiceJobStatusLabels,
  useWorkSiteLabels
} from "~/components/ServiceJob";
import { userContext } from "~/context";
import { useUrlParams } from "~/hooks";
import { serviceCoverages, serviceWorkSites } from "~/services/models";
import {
  getOpenServiceJobsByLocation,
  getServiceJobsAssignedTo
} from "~/services/service.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["serviceJob"]
};

const OPEN_STATUSES = [
  "Open",
  "Awaiting Approval",
  "In Progress",
  "On Hold"
] as const satisfies readonly Database["public"]["Enums"]["serviceJobStatus"][];

/** The values of one `?filter=key:op:value` param, for `eq` and `in`. */
function filterValues(filters: string[], key: string): string[] {
  for (const filter of filters) {
    const [filterKey, operator, value] = filter.split(":");
    if (filterKey !== key || !value) continue;
    if (operator === "in") return value.split(",");
    if (operator === "eq") return [value];
  }
  return [];
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const locationId = context.get(userContext)?.locationId;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.toLowerCase() ?? "";
  const filters = url.searchParams.getAll("filter").filter(Boolean);
  const statuses = filterValues(filters, "status");
  const coverages = filterValues(filters, "coverage");
  const workSites = filterValues(filters, "workSite");

  // "Today" is the company's day: an assignment is dated on that calendar.
  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  const [openJobs, myJobs] = await Promise.all([
    getOpenServiceJobsByLocation(client, companyId, locationId),
    getServiceJobsAssignedTo(client, companyId, userId, today)
  ]);

  type Job = NonNullable<typeof openJobs.data>[number];
  const matches = (job: Job) =>
    (!statuses.length || statuses.includes(job.status)) &&
    (!coverages.length || coverages.includes(job.coverage)) &&
    (!workSites.length || workSites.includes(job.workSite)) &&
    (!search ||
      [
        job.serviceJobId,
        job.customer?.name,
        job.item?.name,
        job.trackedEntity?.readableId,
        job.problem
      ].some((value) => value?.toLowerCase().includes(search)));

  return {
    openJobs: (openJobs.data ?? []).filter(matches),
    myJobs: (myJobs.data ?? []).filter(matches),
    today,
    hasLocation: !!locationId
  };
}

type ServiceJobCardData = Awaited<
  ReturnType<typeof loader>
>["openJobs"][number];

function getPriorityIcon(
  priority: Database["public"]["Enums"]["serviceJobPriority"]
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

function ServiceJobCard({ job }: { job: ServiceJobCardData }) {
  const workSites = useWorkSiteLabels();
  const unit = [job.item?.name, job.trackedEntity?.readableId]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link to={path.to.serviceJob(job.id)}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer p-0">
        <CardHeader className="pb-2">
          <HStack className="justify-between">
            <HStack spacing={2} className="min-w-0">
              <span className="font-mono text-sm whitespace-nowrap">
                {job.serviceJobId}
              </span>
              <ServiceJobStatus status={job.status} />
            </HStack>
            <HStack spacing={2} className="shrink-0">
              {job.assignee && <EmployeeAvatar employeeId={job.assignee} />}
              {getPriorityIcon(job.priority)}
            </HStack>
          </HStack>
          <CardTitle className="text-base truncate">
            {job.customer?.name}
          </CardTitle>
          {unit && (
            <CardDescription className="text-xs truncate">
              {unit}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <VStack spacing={2} className="items-start">
            {job.problem && (
              <p className="text-sm line-clamp-2 w-full">{job.problem}</p>
            )}
            <HStack spacing={2} className="flex-wrap">
              <CoverageBadge coverage={job.coverage} />
              <Badge variant="outline">{workSites[job.workSite]}</Badge>
            </HStack>
          </VStack>
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
    <MesEmptyState
      className="flex-1 w-full h-[calc(100dvh-var(--header-height)*2-40px-var(--announcement-height,0px))]"
      title={message}
      action={
        onClear ? (
          <Button onClick={onClear}>
            <Trans>Clear Search</Trans>
          </Button>
        ) : undefined
      }
    />
  );
}

function JobGrid({
  jobs,
  emptyMessage
}: {
  jobs: ServiceJobCardData[];
  emptyMessage: string;
}) {
  const { t } = useLingui();
  const { hasFilters, clearFilters } = useFilters();
  if (jobs.length > 0) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
        {jobs.map((job) => (
          <ServiceJobCard key={job.id} job={job} />
        ))}
      </div>
    );
  }
  return hasFilters ? (
    <EmptyState message={t`No results found`} onClear={clearFilters} />
  ) : (
    <EmptyState message={emptyMessage} />
  );
}

export default function ServiceRoute() {
  const { t } = useLingui();
  const { openJobs, myJobs, today, hasLocation } =
    useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("mine");
  const newJob = useDisclosure();
  // Phones: the tab row scrolls sideways; keep the active tab in view.
  const tabsListRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the active tab changes
  useEffect(() => {
    tabsListRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
  const [params] = useUrlParams();
  const currentFilters = params.getAll("filter").filter(Boolean);
  const statusLabels = useServiceJobStatusLabels();
  const coverageLabels = useCoverageLabels();
  const workSiteLabels = useWorkSiteLabels();

  const filters = useMemo<ColumnFilter[]>(
    () => [
      {
        accessorKey: "status",
        header: t`Status`,
        pluralHeader: t`Statuses`,
        filter: {
          type: "static",
          options: OPEN_STATUSES.map((status) => ({
            label: statusLabels[status],
            value: status
          }))
        }
      },
      {
        accessorKey: "coverage",
        header: t`Coverage`,
        filter: {
          type: "static",
          options: serviceCoverages.map((coverage) => ({
            label: coverageLabels[coverage],
            value: coverage
          }))
        }
      },
      {
        accessorKey: "workSite",
        header: t`Work Site`,
        filter: {
          type: "static",
          options: serviceWorkSites.map((workSite) => ({
            label: workSiteLabels[workSite],
            value: workSite
          }))
        }
      }
    ],
    [t, statusLabels, coverageLabels, workSiteLabels]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar
        title={<Trans>Service</Trans>}
        actions={
          hasLocation ? (
            <IconButton
              aria-label={t`New Job`}
              variant="ghost"
              size="lg"
              icon={<LuCirclePlus />}
              onClick={newJob.onOpen}
            />
          ) : undefined
        }
      />
      <MesQueueHeader
        title={<Trans>Service</Trans>}
        actions={
          <Button
            leftIcon={<LuCirclePlus />}
            isDisabled={!hasLocation}
            onClick={newJob.onOpen}
          >
            <Trans>New Job</Trans>
          </Button>
        }
      />

      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="w-full p-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <HStack className="justify-between w-full max-md:flex-col max-md:items-stretch max-md:gap-2">
              <TabsList
                ref={tabsListRef}
                className="max-md:-mx-4 max-md:w-[calc(100%+2rem)] max-md:justify-start max-md:overflow-x-auto max-md:px-4 scrollbar-hide max-md:scroll-fade-x"
              >
                <TabsTrigger value="mine">
                  <Trans>Today</Trans>
                  {myJobs.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {myJobs.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="open">
                  <Trans>Open at this location</Trans>
                  {openJobs.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {openJobs.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
              <HStack spacing={2}>
                <SearchFilter
                  param="search"
                  size="sm"
                  placeholder={t`Search`}
                />
                <Filter filters={filters} />
              </HStack>
            </HStack>
            {currentFilters.length > 0 && (
              <HStack className="py-1.5 justify-between w-full">
                <ActiveFilters filters={filters} />
              </HStack>
            )}
            <TabsContent value="mine" className="mt-4">
              <JobGrid
                jobs={myJobs}
                emptyMessage={t`No service jobs assigned to you today`}
              />
            </TabsContent>
            <TabsContent value="open" className="mt-4">
              <JobGrid
                jobs={openJobs}
                emptyMessage={t`No open service jobs at this location`}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {newJob.isOpen && (
        <NewServiceJobModal today={today} onClose={newJob.onClose} />
      )}
    </div>
  );
}
