// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { activeJobStatuses } from "@carbon/database";
import { useChangedRows, useLoaderQuery } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Loading,
  PulsingDot,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useViewport,
  VStack
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds,
  formatRelativeTime,
  pluckUnique
} from "@carbon/utils";
import { now, toCalendarDateTime } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DateRange } from "@react-types/datepicker";
import { Suspense, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuChevronDown,
  LuCirclePlay,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuFile,
  LuInbox,
  LuLayers
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import type { LoaderFunctionArgs } from "react-router";
import { Await, Link, useLoaderData } from "react-router";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import {
  CustomerAvatar,
  DateSelect,
  EmployeeAvatar,
  EmployeeAvatarGroup,
  Empty,
  Hyperlink,
  MetricCard
} from "~/components";
import { CSVLink } from "~/components/CSVLink";
import { usePercentFormatter } from "~/hooks";
import { useUser } from "~/hooks/useUser";
import type { ActiveProductionEvent } from "~/modules/production";
import {
  getActiveProductionEvents,
  getUnbatchedBatchableOperationCount,
  KPIs
} from "~/modules/production";
import { getDeadlineIcon } from "~/modules/production/ui/Jobs";
import type { WorkCenter } from "~/modules/resources";
import { getWorkCentersListWithBlockingStatus } from "~/modules/resources";

import type { loader as kpiLoader } from "~/routes/api+/production.kpi.$key";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";

export const handle: Handle = {
  realtime: ["job", "jobOperation"]
};

const chartConfig = {
  value: {
    color: "hsl(var(--primary))"
  },
  actual: {
    color: "hsl(var(--chart-1))",
    label: "Actual"
  },
  estimate: {
    color: "hsl(var(--chart-2))",
    label: "Estimate"
  }
} satisfies ChartConfig;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const [activeJobs, assignedJobs, unbatchedOperations, workCenters] =
    await Promise.all([
      client
        .from("job")
        .select("id,status,assignee")
        .eq("companyId", companyId)
        .in("status", activeJobStatuses),
      client
        .from("job")
        .select("id,status,assignee")
        .eq("companyId", companyId)
        .eq("assignee", userId),
      getUnbatchedBatchableOperationCount(client, companyId),
      getWorkCentersListWithBlockingStatus(client, companyId)
    ]);

  return {
    activeJobs: activeJobs.data?.length ?? 0,
    assignedJobs: assignedJobs.data?.length ?? 0,
    unbatchedOperations: unbatchedOperations.count ?? 0,
    workCenters: workCenters.data ?? [],
    events: getActiveProductionEvents(client, companyId)
  };
}

export default function ProductionDashboard() {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const { activeJobs, assignedJobs, unbatchedOperations, events, workCenters } =
    useLoaderData<typeof loader>();

  const user = useUser();

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState<
    "utilization" | "completionTime" | "estimatesVsActuals"
  >("utilization");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = toCalendarDateTime(now("UTC"));
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedKpiData = KPIs.find((k) => k.key === selectedKpi) || KPIs[0];

  const kpiFetcher = useLoaderQuery<typeof kpiLoader>(
    `${path.to.api.productionKpi(
      selectedKpiData.key
    )}?start=${dateRange?.start.toString()}&end=${dateRange?.end.toString()}&interval=${interval}`
  );
  const isFetching = kpiFetcher.isFetching || !kpiFetcher.data;

  const kpiLabels: Record<string, string> = useMemo(
    () => ({
      utilization: t`Work Center Utilization`,
      estimatesVsActuals: t`Estimates vs Actuals`,
      completionTime: t`Completion Time`
    }),
    [t]
  );

  const kpiEmptyMessages: Record<string, string> = useMemo(
    () => ({
      utilization: t`No work center utilization data within range`,
      estimatesVsActuals: t`No completed jobs within range`,
      completionTime: t`No completed jobs within range`
    }),
    [t]
  );

  const totalTimeInInterval = useMemo(() => {
    if (!dateRange) return 0;
    return dateRange.end.compare(dateRange.start) * 24 * 60 * 60 * 1000;
  }, [dateRange]);

  const onIntervalChange = (value: string) => {
    const end = toCalendarDateTime(now("UTC"));
    if (value === "week") {
      const start = end.add({ days: -7 });
      setDateRange({ start, end });
    } else if (value === "month") {
      const start = end.add({ months: -1 });
      setDateRange({ start, end });
    } else if (value === "quarter") {
      const start = end.add({ months: -3 });
      setDateRange({ start, end });
    } else if (value === "year") {
      const start = end.add({ years: -1 });
      setDateRange({ start, end });
    }

    setInterval(value);
  };

  const totalData = useMemo(() => {
    if (!kpiFetcher.data?.data) return null;
    const data = kpiFetcher.data.data;

    if (selectedKpi === "utilization") {
      return {
        // @ts-expect-error
        value: data.reduce((acc, item) => acc + item.value, 0)
      };
    }
    if (selectedKpi === "completionTime") {
      if (data.length === 0) return { value: 0 };
      return {
        // @ts-expect-error
        value: data.reduce((acc, item) => acc + item.value, 0) / data.length
      };
    }
    if (selectedKpi === "estimatesVsActuals") {
      return {
        // @ts-expect-error
        value: data.reduce((acc, item) => acc + item.actual, 0)
      };
    }
    return { value: 0 };
  }, [kpiFetcher.data?.data, selectedKpi]);

  const previousTotalData = useMemo(() => {
    if (selectedKpi === "estimatesVsActuals") {
      if (!kpiFetcher.data?.data) return null;
      return {
        value: kpiFetcher.data.data.reduce(
          // @ts-expect-error TS2339 - TODO: fix type
          (acc, item) => acc + item.estimate,
          0
        )
      };
    }

    if (!kpiFetcher.data?.previousPeriodData) return null;
    const data = kpiFetcher.data.previousPeriodData as { value: number }[];

    if (selectedKpi === "utilization") {
      return {
        value: data.reduce((acc, item) => acc + item.value, 0)
      };
    }
    if (selectedKpi === "completionTime") {
      if (data.length === 0) return { value: 0 };
      return {
        value: data.reduce((acc, item) => acc + item.value, 0) / data.length
      };
    }
    return { value: 0 };
  }, [kpiFetcher.data?.data, kpiFetcher.data?.previousPeriodData, selectedKpi]);

  const total = totalData?.value ?? 0;
  const previousTotal = previousTotalData?.value ?? 0;

  const percentageChange =
    previousTotal === 0
      ? total > 0
        ? 100
        : 0
      : ((total - previousTotal) / previousTotal) * 100;

  const formatValue = (value: number) => {
    return formatDurationMilliseconds(value);
  };

  const csvData = useMemo(() => {
    if (!kpiFetcher.data?.data) return [];

    switch (selectedKpiData.key) {
      case "utilization":
        return [
          ["Work Center", "Utilization (%)"],
          ...kpiFetcher.data.data.map((item) => [
            item.key,
            // @ts-expect-error
            (item.value / totalTimeInInterval) * 100
          ])
        ];
      case "estimatesVsActuals":
        return [
          ["Job", "Actual (ms)", "Estimate (ms)"],
          ...kpiFetcher.data.data.map((item) => [
            item.key,
            // @ts-expect-error
            item.actual,
            // @ts-expect-error
            item.estimate
          ])
        ];
      default:
        return [];
    }
  }, [kpiFetcher.data?.data, selectedKpiData.key, totalTimeInInterval]);

  const csvFilename = useMemo(() => {
    const startDate = dateRange?.start.toString();
    const endDate = dateRange?.end.toString();
    return `${kpiLabels[selectedKpiData.key]}_${startDate}_to_${endDate}.csv`;
  }, [dateRange, kpiLabels, selectedKpiData.key]);

  const yAxisWidth = useMemo(() => {
    return (
      (kpiFetcher.data?.data?.reduce((max, wc) => {
        return Math.max(max, wc?.key?.length || 0);
      }, 0) || 0) * 10
    );
  }, [kpiFetcher.data?.data]);

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground bg-card">
      <div className="grid w-full gap-y-4 lg:gap-x-4 grid-cols-1 lg:grid-cols-6 max-md:grid-cols-2 max-md:gap-3">
        <MetricCard
          className="col-span-1 lg:col-span-2"
          icon={<LuCirclePlay />}
          title={<Trans>Active Jobs</Trans>}
          value={activeJobs}
          to={`${path.to.jobs}?filter=status:in:${activeJobStatuses.join(",")}`}
          linkLabel={t`View Active Jobs`}
        />

        <MetricCard
          className="col-span-1 lg:col-span-2"
          icon={<LuInbox />}
          title={<Trans>Jobs Assigned to Me</Trans>}
          value={assignedJobs}
          to={`${path.to.jobs}?filter=assignee:eq:${user.id}`}
          linkLabel={t`View Assigned Jobs`}
        />

        <MetricCard
          className="col-span-1 lg:col-span-2 max-md:col-span-2"
          icon={<LuLayers />}
          title={<Trans>Unbatched Operations</Trans>}
          value={unbatchedOperations}
          to={path.to.newOperationBatch}
          linkLabel={t`Create Batch`}
        />

        <Card className="col-span-1 lg:col-span-6 max-md:col-span-2">
          <HStack className="flex-col items-start gap-2 sm:flex-row sm:justify-between sm:items-center max-md:flex-row max-md:items-center max-md:gap-1.5 max-md:px-3 max-md:pt-3">
            <CardHeader className="max-md:min-w-0 max-md:flex-1 max-md:p-0">
              <div className="flex w-full min-w-0 justify-start items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      rightIcon={<LuChevronDown />}
                      className="hover:bg-background/80 max-md:min-w-0 max-md:flex-1 max-md:justify-between"
                    >
                      <span className="truncate">
                        {kpiLabels[selectedKpiData.key]}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="start">
                    <DropdownMenuRadioGroup
                      value={selectedKpi}
                      // @ts-expect-error
                      onValueChange={setSelectedKpi}
                    >
                      {KPIs.map((kpi) => (
                        <DropdownMenuRadioItem key={kpi.key} value={kpi.key}>
                          {kpiLabels[kpi.key]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardAction className="flex-row items-center gap-2 max-md:shrink-0 max-md:gap-1.5 max-md:p-0">
              <DateSelect
                value={interval}
                onValueChange={onIntervalChange}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="secondary"
                    icon={<LuEllipsisVertical />}
                    aria-label={t`More`}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <CSVLink
                      data={csvData}
                      filename={csvFilename}
                      className="flex flex-row items-center gap-2"
                    >
                      <DropdownMenuIcon icon={<LuFile />} />
                      <Trans>Export CSV</Trans>
                    </CSVLink>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          </HStack>
          <CardContent className="min-h-[320px] flex-col gap-4">
            <VStack className="pl-[3px]" spacing={0}>
              {isFetching ? (
                <div className="flex flex-col gap-0.5 w-full">
                  <Skeleton className="h-8 w-[120px]" />
                  <Skeleton className="h-4 w-[50px]" />
                </div>
              ) : (
                <>
                  <p className="text-3xl font-medium tracking-tighter">
                    {formatValue(total)}
                  </p>
                  {percentageChange >= 0 ? (
                    <Badge variant="green">
                      +{percentageChange.toFixed(0)}%
                    </Badge>
                  ) : (
                    <Badge variant="red">{percentageChange.toFixed(0)}%</Badge>
                  )}
                </>
              )}
            </VStack>
            {!kpiFetcher.isFetching && kpiFetcher.data?.data?.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Empty className="py-8">
                  <p className="text-sm text-muted-foreground">
                    {kpiEmptyMessages[selectedKpiData.key]}
                  </p>
                </Empty>
              </div>
            ) : isPhone ? (
              <Loading isLoading={isFetching} className="w-full">
                <KpiBarList
                  kpi={selectedKpi}
                  data={kpiFetcher.data?.data ?? []}
                  totalTimeInInterval={totalTimeInInterval}
                />
              </Loading>
            ) : (
              <Loading isLoading={isFetching} className="w-full">
                <ChartContainer
                  config={chartConfig}
                  style={{
                    height: `${
                      (kpiFetcher.data?.data?.length ?? 5) *
                      (selectedKpi === "estimatesVsActuals" ? 80 : 40)
                    }px`
                  }}
                >
                  <BarChart
                    accessibilityLayer
                    data={kpiFetcher.data?.data ?? []}
                    layout="vertical"
                    margin={{ right: 30 }}
                  >
                    <YAxis
                      dataKey="key"
                      type="category"
                      tickLine={false}
                      axisLine={false}
                      width={yAxisWidth}
                    />
                    <XAxis type="number" hide />

                    {selectedKpi === "utilization" && (
                      <>
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value) => {
                                const percentage =
                                  totalTimeInInterval === 0
                                    ? "0.00"
                                    : (
                                        ((value as number) /
                                          totalTimeInInterval) *
                                        100
                                      ).toFixed(2);
                                return (
                                  <div className="flex flex-col gap-1">
                                    <div className="font-medium font-mono">
                                      {percentage}%
                                    </div>
                                    <div className="font-mono">
                                      {formatDurationMilliseconds(
                                        value as number
                                      )}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                          }
                        />

                        <Bar
                          dataKey="value"
                          fill="var(--color-value)"
                          radius={2}
                        >
                          <LabelList
                            dataKey="value"
                            position="right"
                            formatter={(value: number) => {
                              const percentage =
                                totalTimeInInterval === 0
                                  ? "0.00"
                                  : (
                                      (value / totalTimeInInterval) *
                                      100
                                    ).toFixed(2);

                              return `${percentage}%`;
                            }}
                            offset={8}
                            className="fill-foreground"
                            fontSize={12}
                          />
                        </Bar>
                      </>
                    )}
                    {selectedKpi === "estimatesVsActuals" && (
                      <>
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name) => {
                                return (
                                  <div className="min-w-64 flex justify-between gap-1">
                                    <div className="font-medium">
                                      {capitalize(name as string)}
                                    </div>
                                    <div className="font-mono">
                                      {formatDurationMilliseconds(
                                        value as number
                                      )}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                          }
                        />

                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar
                          dataKey="actual"
                          fill="var(--color-actual)"
                          radius={2}
                        />
                        <Bar
                          dataKey="estimate"
                          fill="var(--color-estimate)"
                          radius={2}
                        />
                      </>
                    )}
                    {selectedKpi === "completionTime" && (
                      <>
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => value}
                              formatter={(value) => (
                                <span className="font-mono">
                                  {formatDurationMilliseconds(value as number)}
                                </span>
                              )}
                            />
                          }
                        />
                        <Bar
                          dataKey="value"
                          fill="var(--color-value)"
                          radius={2}
                        />
                      </>
                    )}
                  </BarChart>
                </ChartContainer>
              </Loading>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="w-full">
        <Suspense fallback={null}>
          <Await resolve={events}>
            {(resolvedEvents) => (
              <WorkCenterCards
                events={resolvedEvents.data ?? []}
                // @ts-expect-error TS2322 - TODO: fix type
                workCenters={workCenters}
              />
            )}
          </Await>
        </Suspense>
      </div>
    </div>
  );
}

type KpiRow = {
  key: string;
  value?: number;
  actual?: number;
  estimate?: number;
};

/**
 * Phones: the KPI chart as a list. A bar chart's category axis takes half of
 * a phone's width, so each row puts its name and value on one line and draws
 * the bar underneath at full width.
 */
function KpiBarList({
  kpi,
  data,
  totalTimeInInterval
}: {
  kpi: (typeof KPIs)[number]["key"];
  data: KpiRow[];
  totalTimeInInterval: number;
}) {
  const percentFormatter = usePercentFormatter();
  const isComparison = kpi === "estimatesVsActuals";
  const max = Math.max(
    1,
    ...data.map((row) =>
      isComparison
        ? Math.max(row.actual ?? 0, row.estimate ?? 0)
        : (row.value ?? 0)
    )
  );
  const width = (value = 0) => ({ width: `${(value / max) * 100}%` });

  return (
    <div className="flex w-full flex-col gap-3">
      {isComparison && (
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[hsl(var(--chart-1))]" />
            <Trans>Actual</Trans>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[hsl(var(--chart-2))]" />
            <Trans>Estimate</Trans>
          </span>
        </div>
      )}
      {data.map((row) => (
        <div key={row.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{row.key}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {isComparison ? (
                <Trans>
                  {formatDurationMilliseconds(row.actual ?? 0)} of{" "}
                  {formatDurationMilliseconds(row.estimate ?? 0)}
                </Trans>
              ) : kpi === "utilization" ? (
                `${formatDurationMilliseconds(row.value ?? 0)} · ${percentFormatter.format(
                  totalTimeInInterval === 0
                    ? 0
                    : (row.value ?? 0) / totalTimeInInterval
                )}`
              ) : (
                formatDurationMilliseconds(row.value ?? 0)
              )}
            </span>
          </div>
          {isComparison ? (
            <div className="flex flex-col gap-0.5">
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-1))]"
                  style={width(row.actual)}
                />
              </div>
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-2))]"
                  style={width(row.estimate)}
                />
              </div>
            </div>
          ) : (
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary"
                style={width(row.value)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type JobOperationMetaData = {
  customerId?: string | null;
  deadlineType?: "No Deadline" | "ASAP" | "Soft Deadline" | "Hard Deadline";
  description?: string | null;
  dueDate?: string | null;
  jobId?: string | null;
  jobReadableId?: string | null;
  salesOrderId?: string | null;
  salesOrderLineId?: string | null;
  salesOrderReadableId?: string | null;
};

type WorkCenterWithBlocking = WorkCenter & {
  isBlocked?: boolean | null;
  blockingDispatchId?: string | null;
  blockingDispatchReadableId?: string | null;
};

function WorkCenterCards({
  events: initialEvents,
  workCenters
}: {
  events: ActiveProductionEvent[];
  workCenters: WorkCenterWithBlocking[];
}) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const [events, setEvents] = useState<ActiveProductionEvent[]>(initialEvents);
  const [jobOperationMetaData, setJobOperationMetaData] = useState<
    Record<string, JobOperationMetaData>
  >(
    initialEvents.reduce<Record<string, JobOperationMetaData>>((acc, event) => {
      if (event.id) {
        acc[event.jobOperationId] = {
          jobId: event.jobId,
          jobReadableId: event.jobReadableId,
          salesOrderId: event.salesOrderId,
          salesOrderReadableId: event.salesOrderReadableId,
          salesOrderLineId: event.salesOrderLineId,
          customerId: event.customerId,
          description: event.description,
          dueDate: event.dueDate,
          deadlineType: event.deadlineType
        };
      }
      return acc;
    }, {})
  );

  const eventsByWorkCenterId = workCenters.reduce<
    Record<
      string,
      JobOperationMetaData & {
        hasEvents: boolean;
        employeeIds?: (string | null)[];
        descriptionCount?: number;
        jobCount?: number;
      }
    >
  >((acc, workCenter) => {
    const wcEvents = events.filter(
      (event) => event.workCenterId === workCenter.id
    );

    if (wcEvents.length === 0) {
      acc[workCenter.id!] = {
        hasEvents: false
      };
      return acc;
    }

    const firstEvent = wcEvents?.[0];
    if (!firstEvent) {
      acc[workCenter.id!] = {
        hasEvents: false
      };
      return acc;
    }

    const jobOperationId = firstEvent.jobOperationId;

    const employeeIds = pluckUnique(wcEvents, (event) => event.employeeId);

    // Count unique jobs and descriptions
    const uniqueJobs = new Set(
      wcEvents
        .filter((event) => event.jobId && event.workCenterId === workCenter.id)
        .map((event) => event.jobId)
    ).size;

    const uniqueDescriptions = new Set(
      wcEvents
        .filter(
          (event) => event.description && event.workCenterId === workCenter.id
        )
        .map((event) => event.description)
    ).size;

    if (workCenter.id) {
      acc[workCenter.id!] = {
        hasEvents: true,
        employeeIds,
        ...jobOperationMetaData[jobOperationId],
        descriptionCount: uniqueDescriptions,
        jobCount: uniqueJobs
      };
    }

    return acc;
  }, {});

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { carbon, accessToken } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  const ensureMetaData = async (event: { jobOperationId: string }) => {
    if (jobOperationMetaData[event.jobOperationId]) {
      return;
    }

    const jobOperation = await carbon
      ?.from("jobOperation")
      .select(
        "description, ...job(jobId:id, jobReadableId:jobId, customerId, dueDate, deadlineType, salesOrderLineId, ...salesOrderLine(...salesOrder(salesOrderId:id, salesOrderReadableId:salesOrderId)))"
      )
      .eq("id", event.jobOperationId)
      .single();

    if (jobOperation?.data) {
      flushSync(() => {
        setJobOperationMetaData((prev) => ({
          ...prev,
          [event.jobOperationId]: jobOperation.data
        }));
      });
    }
  };

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  useChangedRows<ActiveProductionEvent & { endTime?: string | null }>({
    companyId,
    table: "productionEvent",
    onChange: ({ op, ids, rows }) => {
      if (op === "DELETE") {
        setEvents((prev) => prev.filter((event) => !ids.includes(event.id)));
        return;
      }
      setEvents((prev) => {
        let next = prev;
        for (const row of rows) {
          // A finished event leaves the board; a running one joins or updates.
          if (row.endTime) {
            next = next.filter((event) => event.id !== row.id);
          } else if (next.some((event) => event.id === row.id)) {
            next = next.map((event) =>
              event.id === row.id ? { ...event, ...row } : event
            );
          } else {
            next = [...next, row];
          }
        }
        return next;
      });
      for (const row of rows) {
        if (!row.endTime)
          ensureMetaData({ jobOperationId: row.jobOperationId });
      }
    }
  });

  const cards = workCenters.map((workCenter) => {
    const {
      hasEvents,
      customerId,
      deadlineType,
      description,
      descriptionCount,
      dueDate,
      employeeIds,
      jobCount,
      jobId,
      jobReadableId,
      salesOrderId,
      salesOrderReadableId,
      salesOrderLineId
    } = eventsByWorkCenterId[workCenter?.id ?? ""];

    const isOverdue =
      deadlineType !== "No Deadline" && dueDate
        ? new Date(dueDate) < new Date()
        : false;

    const isBlocked = workCenter.isBlocked && workCenter.blockingDispatchId;

    const deadlineLabel = deadlineType
      ? ["ASAP", "No Deadline"].includes(deadlineType)
        ? deadlineType
        : dueDate
          ? t`Due ${formatRelativeTime(convertDateStringToIsoString(dueDate))}`
          : "–"
      : null;

    if (isPhone) {
      // Phones: one row per work center in a single card, with every
      // fact the desktop card shows.
      return (
        <div
          key={workCenter.id}
          className={cn(
            "flex items-start gap-3 px-4 py-3",
            isBlocked && "bg-red-100 dark:bg-red-900/40"
          )}
        >
          {isBlocked ? (
            <span className="mt-2 size-2 shrink-0 rounded-full bg-red-500" />
          ) : (
            <PulsingDot inactive={!hasEvents} className="mt-2 shrink-0" />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
            <p className="truncate text-base font-medium">{workCenter.name}</p>
            {isBlocked ? (
              <Link
                to={path.to.maintenanceDispatch(workCenter.blockingDispatchId!)}
                className="text-red-800 dark:text-red-400"
              >
                <Trans>
                  Blocked by {workCenter.blockingDispatchReadableId}
                </Trans>
              </Link>
            ) : !hasEvents ? (
              <p className="text-muted-foreground">
                <Trans>Inactive</Trans>
              </p>
            ) : (
              <>
                {(jobReadableId || description) && (
                  <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    {jobId && jobReadableId && (
                      <Hyperlink to={path.to.job(jobId)} className="shrink-0">
                        {jobReadableId}
                      </Hyperlink>
                    )}
                    {jobCount !== undefined && jobCount > 1 && (
                      <span className="shrink-0 font-mono">{`+${jobCount - 1}`}</span>
                    )}
                    {description && (
                      <span className="truncate">{description}</span>
                    )}
                    {descriptionCount !== undefined && descriptionCount > 1 && (
                      <span className="shrink-0 font-mono">{`+${descriptionCount - 1}`}</span>
                    )}
                  </p>
                )}
                {(salesOrderReadableId || customerId) && (
                  <div className="flex min-w-0 items-center gap-2">
                    {salesOrderId &&
                      salesOrderLineId &&
                      salesOrderReadableId && (
                        <Hyperlink
                          to={path.to.salesOrderLine(
                            salesOrderId,
                            salesOrderLineId
                          )}
                          className="shrink-0"
                        >
                          {salesOrderReadableId}
                        </Hyperlink>
                      )}
                    {customerId && (
                      <span className="min-w-0 truncate">
                        <CustomerAvatar customerId={customerId} />
                      </span>
                    )}
                  </div>
                )}
                {deadlineType && (
                  <p
                    className={cn(
                      "flex items-center gap-1.5",
                      isOverdue ? "text-red-500" : "text-muted-foreground"
                    )}
                  >
                    {getDeadlineIcon(deadlineType)}
                    <span className="truncate">{deadlineLabel}</span>
                  </p>
                )}
              </>
            )}
          </div>
          {employeeIds?.length ? (
            <div className="shrink-0">
              {employeeIds.length > 1 ? (
                <EmployeeAvatarGroup
                  employeeIds={employeeIds.filter((id) => id !== null)}
                />
              ) : (
                <EmployeeAvatar employeeId={employeeIds[0]} withName={false} />
              )}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <Card
        key={workCenter.id}
        className={cn(
          "p-0 h-[300px] col-span-6 max-md:col-span-full lg:col-span-3 xl:col-span-2",
          isBlocked && "bg-red-100 dark:bg-red-900/50"
        )}
      >
        <HStack
          className={cn(
            "justify-between w-full relative",
            isBlocked && "text-red-800 dark:text-red-400"
          )}
        >
          <CardHeader>
            <CardTitle className="line-clamp-2 text-base">
              {workCenter.name}
            </CardTitle>
            {isBlocked && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={path.to.maintenanceDispatch(
                      workCenter.blockingDispatchId!
                    )}
                    className="inline-flex items-center gap-1 text-xs font-normal"
                  >
                    <span>
                      <Trans>
                        Blocked by {workCenter.blockingDispatchReadableId}
                      </Trans>
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    <Trans>View maintenance dispatch</Trans>
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </CardHeader>
          <CardAction className="pt-2">
            {!isBlocked && (
              <PulsingDot inactive={!hasEvents} className="mt-2" />
            )}
          </CardAction>
        </HStack>
        <CardContent
          className={cn(
            "flex items-start justify-start p-6 pt-3 border-t",
            // the content's own dark background is translucent; keep the
            // red card color from bleeding through it
            isBlocked && "dark:bg-card"
          )}
        >
          {!hasEvents ? (
            <p className="text-muted-foreground text-center w-full h-full flex flex-col gap-2 items-center justify-center text-sm">
              <Trans>Inactive</Trans>
            </p>
          ) : (
            <div className="flex flex-col gap-2 items-start justify-start text-sm">
              {jobId && jobReadableId && (
                <HStack className="justify-start space-x-2">
                  <LuCirclePlay className="text-muted-foreground flex-shrink-0" />
                  <Hyperlink to={path.to.job(jobId)} className="truncate">
                    {jobReadableId}
                  </Hyperlink>
                  {jobCount !== undefined &&
                    Number.isInteger(jobCount) &&
                    jobCount > 1 && (
                      <div className="text-muted-foreground font-mono font-semibold flex items-center justify-center flex-shrink-0">
                        {`+${jobCount - 1}`}
                      </div>
                    )}
                </HStack>
              )}

              {description && (
                <HStack className="justify-start space-x-2">
                  <LuClipboardCheck className="text-muted-foreground flex-shrink-0" />
                  <span className="text-sm line-clamp-1 truncate">
                    {description}
                  </span>
                  {descriptionCount !== undefined &&
                    Number.isInteger(descriptionCount) &&
                    descriptionCount > 1 && (
                      <div className="text-muted-foreground font-mono font-semibold flex items-center justify-center flex-shrink-0">
                        {`+${descriptionCount - 1}`}
                      </div>
                    )}
                </HStack>
              )}

              {salesOrderId && salesOrderLineId && salesOrderReadableId && (
                <HStack className="justify-start space-x-2">
                  <RiProgress8Line className="text-muted-foreground flex-shrink-0" />
                  <Hyperlink
                    to={path.to.salesOrderLine(salesOrderId, salesOrderLineId)}
                    className="truncate"
                  >
                    {salesOrderReadableId}
                  </Hyperlink>
                </HStack>
              )}

              {customerId && (
                <HStack className="justify-start space-x-2">
                  <LuInbox className="text-muted-foreground flex-shrink-0" />
                  <CustomerAvatar customerId={customerId} />
                </HStack>
              )}

              {deadlineType && (
                <HStack className="justify-start space-x-2">
                  {getDeadlineIcon(deadlineType)}
                  <Tooltip>
                    <TooltipTrigger>
                      <span
                        className={cn(
                          "text-sm truncate",
                          isOverdue ? "text-red-500" : ""
                        )}
                      >
                        {deadlineLabel}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right">{deadlineType}</TooltipContent>
                  </Tooltip>
                </HStack>
              )}
            </div>
          )}
        </CardContent>
        {employeeIds?.length ? (
          <CardFooter className="border-t py-3 bg-muted/30 text-sm">
            {employeeIds.length > 1 ? (
              <EmployeeAvatarGroup
                employeeIds={employeeIds.filter((id) => id !== null)}
              />
            ) : (
              <EmployeeAvatar employeeId={employeeIds[0]} />
            )}
          </CardFooter>
        ) : (
          <CardFooter className="h-[var(--topbar-height)]" />
        )}
      </Card>
    );
  });

  if (isPhone) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Work Centers</Trans>
        </h2>
        <Card className="divide-y divide-border overflow-hidden bg-card">
          {cards}
        </Card>
      </section>
    );
  }

  return <div className="w-full grid grid-cols-6 gap-4">{cards}</div>;
}
