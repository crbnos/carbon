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
  DateRangePicker,
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
  useMount,
} from "@carbon/react";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@carbon/react/Chart";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import { now, toCalendarDateTime } from "@internationalized/date";
import type { DateRange } from "@react-types/datepicker";
import {
  Await,
  defer,
  Link,
  useFetcher,
  useLoaderData,
} from "@remix-run/react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CSVLink } from "react-csv";
import {
  LuArrowUpRight,
  LuChevronDown,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuFile,
  LuHardHat,
  LuSquareUser,
  LuUserRoundCheck,
} from "react-icons/lu";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import {
  CustomerAvatar,
  EmployeeAvatar,
  EmployeeAvatarGroup,
  Empty,
  Hyperlink,
} from "~/components";
import { useUser } from "~/hooks/useUser";
import type { ActiveProductionEvent } from "~/modules/production";
import { getActiveProductionEvents, KPIs } from "~/modules/production";
import { chartIntervals } from "~/modules/shared";
import type { loader as kpiLoader } from "~/routes/api+/production.kpi.$key";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";

import { useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { flushSync } from "react-dom";
import { RiProgress8Line } from "react-icons/ri";
import { getDeadlineIcon, getDeadlineText } from "~/modules/production/ui/Jobs";
import type { WorkCenter } from "~/modules/resources";
import { getWorkCentersList } from "~/modules/resources";

const OPEN_JOB_STATUSES = ["Ready", "In Progress", "Paused"] as const;

const chartConfig = {
  value: {
    color: "hsl(var(--primary))",
  },
  actual: {
    color: "hsl(var(--chart-1))",
    label: "Actual",
  },
  estimate: {
    color: "hsl(var(--chart-2))",
    label: "Estimate",
  },
} satisfies ChartConfig;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
  });

  const [activeJobs, assignedJobs, workCenters] = await Promise.all([
    client
      .from("job")
      .select("id,status,assignee")
      .eq("companyId", companyId)
      .in("status", OPEN_JOB_STATUSES),
    client
      .from("job")
      .select("id,status,assignee")
      .eq("companyId", companyId)
      .eq("assignee", userId),
    getWorkCentersList(client, companyId),
  ]);

  return defer({
    activeJobs: activeJobs.data?.length ?? 0,
    assignedJobs: assignedJobs.data?.length ?? 0,
    workCenters: workCenters.data ?? [],
    events: getActiveProductionEvents(client, companyId),
  });
}

export default function ProductionDashboard() {
  const { activeJobs, assignedJobs, events, workCenters } =
    useLoaderData<typeof loader>();

  const user = useUser();
  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const isFetching = kpiFetcher.state !== "idle" || !kpiFetcher.data;

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState<
    "utilization" | "completionTime" | "estimatesVsActuals"
  >("utilization");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = toCalendarDateTime(now("UTC"));
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedInterval =
    chartIntervals.find((i) => i.key === interval) || chartIntervals[1];
  const selectedKpiData = KPIs.find((k) => k.key === selectedKpi) || KPIs[0];

  const totalTimeInInterval = useMemo(() => {
    if (!dateRange) return 0;
    return dateRange.end.compare(dateRange.start) * 24 * 60 * 60 * 1000;
  }, [dateRange]);

  useEffect(() => {
    kpiFetcher.load(
      `${path.to.api.productionKpi(
        selectedKpiData.key
      )}?start=${dateRange?.start.toString()}&end=${dateRange?.end.toString()}&interval=${interval}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKpi, dateRange, interval, selectedKpiData.key]);

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

  const getTotal = (
    key: string,
    data?: { value: number }[] | { actual: number; estimate: number }[]
  ) => {
    if (!data) return 0;
    switch (key) {
      case "utilization":
        return data.reduce((acc, item) => {
          // @ts-expect-error
          return acc + item.value;
        }, 0);
      case "completionTime":
        return data.length === 0
          ? 0
          : data.reduce((acc, item) => {
              // @ts-expect-error
              return acc + item.value;
            }, 0) / data.length;
      case "estimate":
        return data.reduce((acc, item) => {
          // @ts-expect-error
          return acc + item.estimate;
        }, 0);
      case "actual":
        return data.reduce((acc, item) => {
          // @ts-expect-error
          return acc + item.actual;
        }, 0);
      default:
        return 0;
    }
  };

  const total = getTotal(
    selectedKpi === "estimatesVsActuals" ? "actual" : selectedKpi,
    kpiFetcher.data?.data
  );

  const previousTotal = getTotal(
    selectedKpi === "estimatesVsActuals" ? "estimate" : selectedKpi,
    selectedKpi === "estimatesVsActuals"
      ? kpiFetcher.data?.data
      : (kpiFetcher.data?.previousPeriodData as {
          value: number;
        }[])
  );

  const percentageChange =
    previousTotal === 0
      ? total > 0
        ? 100
        : 0
      : ((total - previousTotal) / previousTotal) * 100;

  const csvData = useMemo(() => {
    if (!kpiFetcher.data?.data) return [];

    switch (selectedKpiData.key) {
      case "utilization":
        return [
          ["Work Center", "Utilization (%)"],
          ...kpiFetcher.data.data.map((item) => [
            item.key,
            // @ts-expect-error
            (item.value / totalTimeInInterval) * 100,
          ]),
        ];
      case "estimatesVsActuals":
        return [
          ["Job", "Actual (ms)", "Estimate (ms)"],
          ...kpiFetcher.data.data.map((item) => [
            item.key,
            // @ts-expect-error
            item.actual,
            // @ts-expect-error
            item.estimate,
          ]),
        ];
      default:
        return [];
    }
  }, [kpiFetcher.data?.data, selectedKpiData.key, totalTimeInInterval]);

  const csvFilename = useMemo(() => {
    const startDate = dateRange?.start.toString();
    const endDate = dateRange?.end.toString();
    return `${selectedKpiData.label}_${startDate}_to_${endDate}.csv`;
  }, [dateRange, selectedKpiData.label]);

  const yAxisWidth = useMemo(() => {
    return (
      (kpiFetcher.data?.data?.reduce((max, wc) => {
        return Math.max(max, wc?.key?.length || 0);
      }, 0) || 0) * 10
    );
  }, [kpiFetcher.data?.data]);

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      <div className="grid w-full gap-y-4 lg:gap-x-4 grid-cols-1 lg:grid-cols-6">
        <Card className="col-span-3 p-6 rounded-xl items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuHardHat className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${path.to.jobs}?filter=status:in:${OPEN_JOB_STATUSES.join(
                  ","
                )}`}
              >
                View Active Jobs
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {activeJobs}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Active Jobs
            </p>
          </div>
        </Card>

        <Card className="col-span-3 p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuUserRoundCheck className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
            >
              <Link to={`${path.to.jobs}?filter=assignee:eq:${user.id}`}>
                View Assigned Jobs
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {assignedJobs}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Jobs Assigned to Me
            </p>
          </div>
        </Card>

        <Card className="col-span-6 p-0">
          <HStack className="justify-between items-start">
            <CardHeader className="pb-0">
              <div className="flex w-full justify-start items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      rightIcon={<LuChevronDown />}
                      className="hover:bg-background/80"
                    >
                      <span>{selectedKpiData.label}</span>
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
                          {kpi.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      rightIcon={<LuChevronDown />}
                      className="hover:bg-background/80"
                    >
                      <span>
                        {selectedInterval.key === "custom"
                          ? selectedInterval.label
                          : `Last ${selectedInterval.label}`}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="start">
                    <DropdownMenuRadioGroup
                      value={interval}
                      onValueChange={onIntervalChange}
                    >
                      {chartIntervals.map((i) => (
                        <DropdownMenuRadioItem key={i.key} value={i.key}>
                          {i.key === "custom" ? i.label : `Last ${i.label}`}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {interval === "custom" && (
                  <DateRangePicker
                    size="sm"
                    value={dateRange}
                    onChange={setDateRange}
                  />
                )}
              </div>
              <HStack className="pl-[3px] pt-1">
                {isFetching ? (
                  <Skeleton className="h-8 w-1/2" />
                ) : (
                  <>
                    <p className="text-xl font-semibold tracking-tight">
                      {formatDurationMilliseconds(total)}
                    </p>

                    {percentageChange >= 0 ? (
                      <Badge variant="green">
                        +{percentageChange.toFixed(0)}%
                      </Badge>
                    ) : (
                      <Badge variant="red">
                        {percentageChange.toFixed(0)}%
                      </Badge>
                    )}
                  </>
                )}
              </HStack>
            </CardHeader>
            <CardAction className="py-6 px-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="secondary"
                    icon={<LuEllipsisVertical />}
                    aria-label="More"
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
                      Export CSV
                    </CSVLink>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          </HStack>
          <CardContent className="max-h-[600px] min-h-[320px] p-6 pb-12">
            {kpiFetcher.state === "idle" &&
            kpiFetcher.data?.data?.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Empty className="py-8">
                  <p className="text-sm text-muted-foreground">
                    {selectedKpiData.emptyMessage}
                  </p>
                </Empty>
              </div>
            ) : (
              <Loading isLoading={isFetching} className="w-full">
                <ChartContainer
                  config={chartConfig}
                  style={{
                    height: `${
                      (kpiFetcher.data?.data?.length ?? 5) *
                      (selectedKpi === "estimatesVsActuals" ? 80 : 40)
                    }px`,
                  }}
                >
                  <BarChart
                    accessibilityLayer
                    data={kpiFetcher.data?.data ?? []}
                    layout="vertical"
                    margin={{
                      right: 30,
                    }}
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
                workCenters={workCenters}
              />
            )}
          </Await>
        </Suspense>
      </div>
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

function WorkCenterCards({
  events: initialEvents,
  workCenters,
}: {
  events: ActiveProductionEvent[];
  workCenters: WorkCenter[];
}) {
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
          deadlineType: event.deadlineType,
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
        hasEvents: false,
      };
      return acc;
    }

    const firstEvent = wcEvents?.[0];
    if (!firstEvent) {
      acc[workCenter.id!] = {
        hasEvents: false,
      };
      return acc;
    }

    const jobOperationId = firstEvent.jobOperationId;

    const employeeIds =
      Array.from(new Set(wcEvents.map((event) => event.employeeId))) ?? [];

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
        jobCount: uniqueJobs,
      };
    }

    return acc;
  }, {});

  const { carbon, accessToken } = useCarbon();
  const {
    company: { id: companyId },
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
          [event.jobOperationId]: jobOperation.data,
        }));
      });
    }
  };

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  const channelRef = useRef<RealtimeChannel | null>(null);

  useMount(() => {
    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel(`production-dashboard-work-centers:${companyId}`)
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
              setEvents((prev) => [...prev, inserted as ActiveProductionEvent]);
              ensureMetaData({ jobOperationId: inserted.jobOperationId });
            } else if (payload.eventType === "UPDATE") {
              const { new: updated } = payload;
              setEvents((prev) => {
                if (updated.endTime) {
                  return prev.filter((event) => event.id !== updated.id);
                }
                const exists = prev.some((event) => event.id === updated.id);
                if (exists) {
                  return prev.map((event) =>
                    event.id === updated.id ? { ...event, ...updated } : event
                  );
                }
                return [...prev, updated as ActiveProductionEvent];
              });
            } else if (payload.eventType === "DELETE") {
              const { old: deleted } = payload;
              setEvents((prev) =>
                prev.filter((event) => event.id !== deleted.id)
              );
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
    if (carbon && accessToken && channelRef.current) {
      carbon.realtime.setAuth(accessToken);
    }
  }, [accessToken, carbon]);

  return (
    <div className="w-full grid grid-cols-6 gap-4">
      {workCenters.map((workCenter) => {
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
          salesOrderLineId,
        } = eventsByWorkCenterId[workCenter?.id ?? ""];

        const isOverdue =
          deadlineType !== "No Deadline" && dueDate
            ? new Date(dueDate) < new Date()
            : false;

        return (
          <Card
            key={workCenter.id}
            className="p-0 h-[300px] col-span-6 lg:col-span-3 xl:col-span-2"
          >
            <HStack className="justify-between w-full relative">
              <CardHeader>
                <CardTitle className="line-clamp-2 text-base">
                  {workCenter.name}
                </CardTitle>
              </CardHeader>
              <CardAction className="pt-2">
                <PulsingDot inactive={!hasEvents} />
              </CardAction>
            </HStack>
            <CardContent className="flex items-start justify-start p-6 pt-3 border-t">
              {!hasEvents ? (
                <p className="text-muted-foreground text-center w-full h-full flex flex-col gap-2 items-center justify-center text-sm">
                  Inactive
                </p>
              ) : (
                <div className="flex flex-col gap-2 items-start justify-start text-sm">
                  {jobId && jobReadableId && (
                    <HStack className="justify-start space-x-2">
                      <LuHardHat className="text-muted-foreground flex-shrink-0" />
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
                        to={path.to.salesOrderLine(
                          salesOrderId,
                          salesOrderLineId
                        )}
                        className="truncate"
                      >
                        {salesOrderReadableId}
                      </Hyperlink>
                    </HStack>
                  )}

                  {customerId && (
                    <HStack className="justify-start space-x-2">
                      <LuSquareUser className="text-muted-foreground flex-shrink-0" />
                      <CustomerAvatar customerId={customerId} />
                    </HStack>
                  )}

                  {deadlineType && (
                    <HStack className="justify-start space-x-2">
                      {getDeadlineIcon(deadlineType, isOverdue)}
                      <Tooltip>
                        <TooltipTrigger>
                          <span
                            className={cn(
                              "text-sm truncate",
                              isOverdue ? "text-red-500" : ""
                            )}
                          >
                            {["ASAP", "No Deadline"].includes(deadlineType)
                              ? getDeadlineText(deadlineType)
                              : dueDate
                              ? `Due ${formatRelativeTime(
                                  convertDateStringToIsoString(dueDate)
                                )}`
                              : "–"}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {getDeadlineText(deadlineType)}
                        </TooltipContent>
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
              <CardFooter className="h-[49px]" />
            )}
          </Card>
        );
      })}
    </div>
  );
}
