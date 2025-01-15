import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
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
  Skeleton,
} from "@carbon/react";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@carbon/react/Chart";
import { formatDurationMilliseconds } from "@carbon/utils";
import { now, toCalendarDateTime } from "@internationalized/date";
import type { DateRange } from "@react-types/datepicker";
import { json, Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import {
  LuArrowUpRight,
  LuChevronDown,
  LuEllipsisVertical,
  LuFile,
  LuHardHat,
  LuLayoutList,
  LuUserRoundCheck,
} from "react-icons/lu";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { Empty } from "~/components";
import { useUser } from "~/hooks/useUser";
import { KPIs } from "~/modules/production";
import { chartIntervals } from "~/modules/shared";
import type { loader as kpiLoader } from "~/routes/api+/production.kpi.$key";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";

const OPEN_JOB_STATUSES = ["Ready", "In Progress", "Paused"] as const;

const chartConfig = {
  actual: {
    color: "hsl(var(--primary))",
    label: "Actual",
  },
  estimate: {
    color: "hsl(var(--destructive))",
    label: "Estimate",
  },
} satisfies ChartConfig;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
  });

  const [activeJobs, assignedJobs] = await Promise.all([
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
  ]);

  return json({
    activeJobs: activeJobs.data?.length ?? 0,
    assignedJobs: assignedJobs.data?.length ?? 0,
  });
}

export default function ProductionDashboard() {
  const { activeJobs, assignedJobs } = useLoaderData<typeof loader>();

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
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card className="p-6 rounded-xl items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
              <LuLayoutList className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuHardHat />}
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

        <Card className="p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
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

        <Card className="col-span-2 p-0">
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
              <HStack className="text-sm text-muted-foreground pl-[3px] pt-1">
                {isFetching ? (
                  <Skeleton className="h-5 w-1/4" />
                ) : (
                  <>
                    <p>{formatDurationMilliseconds(total)}</p>

                    {percentageChange > 0 ? (
                      <span className="text-emerald-500">
                        +{percentageChange.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-red-500">
                        {percentageChange.toFixed(0)}%
                      </span>
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
          <CardContent className="p-6 pb-12">
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
                          fill="var(--color-actual)"
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
                          fill="var(--color-actual)"
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
    </div>
  );
}
