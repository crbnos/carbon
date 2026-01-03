import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
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
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { formatDurationMilliseconds } from "@carbon/utils";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import {
  LuArrowUpRight,
  LuCalendarCheck,
  LuChevronDown,
  LuEllipsisVertical,
  LuFile,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import {
  Await,
  Link,
  type LoaderFunctionArgs,
  useFetcher,
  useLoaderData
} from "react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Empty, Hyperlink } from "~/components";
import { useWorkCenters } from "~/components/Form/WorkCenters";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  MaintenanceKPIs,
  maintenanceSource
} from "~/modules/resources/resources.models";
import MaintenanceSource from "~/modules/resources/ui/Maintenance/MaintenanceSource";
import MaintenanceStatus from "~/modules/resources/ui/Maintenance/MaintenanceStatus";
import { chartIntervals } from "~/modules/shared/shared.models";
import type { loader as kpiLoader } from "~/routes/api+/resources.kpi.$key";

import { path } from "~/utils/path";

const OPEN_STATUSES = ["Open", "Assigned", "In Progress"] as const;

const chartConfig = {} satisfies ChartConfig;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    view: "resources"
  });

  const [openDispatches, openScheduled, openReactive, recentlyCreated] =
    await Promise.all([
      client
        .from("maintenanceDispatch")
        .select("id", { count: "exact" })
        .in("status", OPEN_STATUSES)
        .eq("companyId", companyId),
      client
        .from("maintenanceDispatch")
        .select("id", { count: "exact" })
        .in("status", OPEN_STATUSES)
        .eq("source", "Scheduled")
        .eq("companyId", companyId),
      client
        .from("maintenanceDispatch")
        .select("id", { count: "exact" })
        .in("status", OPEN_STATUSES)
        .eq("source", "Reactive")
        .eq("companyId", companyId),
      client
        .from("maintenanceDispatch")
        .select(
          "id, maintenanceDispatchId, status, source, priority, workCenterId, createdAt, assignee"
        )
        .eq("companyId", companyId)
        .order("createdAt", { ascending: false })
        .limit(10)
    ]);

  // Deferred promise for Assigned to Me
  const assignedToMe = client
    .from("maintenanceDispatch")
    .select(
      "id, maintenanceDispatchId, status, source, priority, workCenterId, createdAt"
    )
    .eq("companyId", companyId)
    .eq("assignee", userId)
    .in("status", OPEN_STATUSES)
    .order("priority", { ascending: false })
    .limit(10)
    .then((result) => result.data ?? []);

  return {
    openDispatches: openDispatches.count ?? 0,
    openScheduled: openScheduled.count ?? 0,
    openReactive: openReactive.count ?? 0,
    recentlyCreated: recentlyCreated.data ?? [],
    assignedToMe
  };
}

export default function MaintenanceDashboard() {
  const {
    openDispatches,
    openScheduled,
    openReactive,
    recentlyCreated,
    assignedToMe
  } = useLoaderData<typeof loader>();

  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const isFetching = kpiFetcher.state !== "idle" || !kpiFetcher.data;

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric"
  });

  const currencyFormatter = useCurrencyFormatter();
  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short"
  });

  const [workCenterId, setWorkCenterId] = useState<string>("all");
  const workCenters = useWorkCenters();
  const workCenterOptions = useMemo(() => {
    return [
      { label: "All Work Centers", value: "all" },
      ...workCenters.map((wc) => ({
        label: wc.label,
        value: wc.value
      }))
    ];
  }, [workCenters]);

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("mttr");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = today("UTC");
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedInterval =
    chartIntervals.find((i) => i.key === interval) || chartIntervals[1];
  const selectedKpiData =
    MaintenanceKPIs.find((k) => k.key === selectedKpi) || MaintenanceKPIs[0];

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    kpiFetcher.load(
      `${path.to.api.resourcesKpi(
        selectedKpiData.key
      )}?start=${dateRange?.start.toString()}&end=${dateRange?.end.toString()}&interval=${interval}${
        workCenterId === "all" ? "" : `&workCenterId=${workCenterId}`
      }`
    );
  }, [selectedKpi, dateRange, interval, selectedKpiData.key, workCenterId]);

  const onIntervalChange = (value: string) => {
    const end = today("UTC");
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

    // For time-based KPIs (MTTR, MTBF), calculate weighted average
    if (selectedKpi === "mttr" || selectedKpi === "mtbf") {
      const nonZeroValues = kpiFetcher.data.data.filter((d) => d.value > 0);
      if (nonZeroValues.length === 0) return { value: 0 };
      return {
        value:
          nonZeroValues.reduce((acc, curr) => acc + curr.value, 0) /
          nonZeroValues.length
      };
    }

    // For worst performing machines, sum all failures
    if (selectedKpi === "worstPerformingMachines") {
      return {
        value: kpiFetcher.data.data.reduce((acc, curr) => acc + curr.value, 0)
      };
    }

    // For other KPIs, sum the values
    return {
      value: kpiFetcher.data.data.reduce((acc, curr) => acc + curr.value, 0)
    };
  }, [kpiFetcher.data?.data, selectedKpi]);

  const previousTotalData = useMemo(() => {
    if (!kpiFetcher.data?.previousPeriodData) return null;

    // For time-based KPIs (MTTR, MTBF), calculate weighted average
    if (selectedKpi === "mttr" || selectedKpi === "mtbf") {
      const nonZeroValues = kpiFetcher.data.previousPeriodData.filter(
        (d) => d.value > 0
      );
      if (nonZeroValues.length === 0) return { value: 0 };
      return {
        value:
          nonZeroValues.reduce((acc, curr) => acc + curr.value, 0) /
          nonZeroValues.length
      };
    }

    if (selectedKpi === "worstPerformingMachines") {
      return {
        value: kpiFetcher.data.previousPeriodData.reduce(
          (acc, curr) => acc + curr.value,
          0
        )
      };
    }

    return {
      value: kpiFetcher.data.previousPeriodData.reduce(
        (acc, curr) => acc + curr.value,
        0
      )
    };
  }, [kpiFetcher.data?.previousPeriodData, selectedKpi]);

  const total = totalData?.value ?? 0;
  const previousTotal = previousTotalData?.value ?? 0;

  const percentageChange =
    previousTotal === 0
      ? total > 0
        ? 100
        : 0
      : ((total - previousTotal) / previousTotal) * 100;

  // For MTTR, lower is better (faster repairs). For MTBF, higher is better (longer time between failures)
  const isLowerBetter = selectedKpi === "mttr";
  const isBadgePositive = isLowerBetter
    ? percentageChange <= 0
    : percentageChange >= 0;

  const formatValue = (value: number) => {
    // Time-based KPIs (MTTR, MTBF) - value is in seconds
    if (selectedKpi === "mttr" || selectedKpi === "mtbf") {
      return formatDurationMilliseconds(value * 1000);
    }
    // Cost-based KPIs
    if (selectedKpi === "sparePartCost") {
      return currencyFormatter.format(value);
    }
    // Count-based KPIs
    return numberFormatter.format(value);
  };

  const csvData = useMemo(() => {
    if (!kpiFetcher.data?.data) return [];

    if (selectedKpi === "worstPerformingMachines") {
      return [
        ["Work Center", "Failures"],
        ...kpiFetcher.data.data.map((item) => [
          "name" in item ? item.name : "",
          item.value
        ])
      ];
    }

    return [
      ["Date", "Value"],
      ...kpiFetcher.data.data.map((item) => [
        "date" in item
          ? item.date
          : "month" in item
            ? item.month
            : // @ts-ignore
              item.monthKey,
        item.value
      ])
    ];
  }, [kpiFetcher.data?.data, selectedKpi]);

  const csvFilename = useMemo(() => {
    const startDate = dateRange?.start.toString();
    const endDate = dateRange?.end.toString();
    return `${selectedKpiData.label.replace(/ /g, "_")}_${startDate}_to_${endDate}${
      workCenterId === "all"
        ? ""
        : `_${workCenters.find((wc) => wc.value === workCenterId)?.label}`
    }.csv`;
  }, [
    dateRange?.start,
    dateRange?.end,
    selectedKpiData.label,
    workCenterId,
    workCenters
  ]);

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="p-6 rounded-xl items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuWrench className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.maintenanceDispatches
                }?filter=status:in:${OPEN_STATUSES.join(",")}`}
              >
                View Open
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openDispatches}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Dispatches
            </p>
          </div>
        </Card>

        <Card className="p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuCalendarCheck className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.maintenanceDispatches
                }?filter=status:in:${OPEN_STATUSES.join(",")}&filter=source:eq:Scheduled`}
              >
                View Scheduled
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openScheduled}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Scheduled
            </p>
          </div>
        </Card>

        <Card className="p-6 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground dark:shadow-md">
              <LuTriangleAlert className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.maintenanceDispatches
                }?filter=status:in:${OPEN_STATUSES.join(",")}&filter=source:eq:Reactive`}
              >
                View Reactive
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openReactive}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Reactive
            </p>
          </div>
        </Card>
      </div>

      <Card className="p-0">
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
                    onValueChange={setSelectedKpi}
                  >
                    {MaintenanceKPIs.map((kpi) => (
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
              <Combobox
                asButton
                value={workCenterId}
                onChange={setWorkCenterId}
                options={workCenterOptions}
                size="sm"
                className="min-w-[160px] gap-4"
              />
            </div>
            <HStack className="pl-[3px] pt-1">
              {isFetching ? (
                <Skeleton className="h-8 w-1/2" />
              ) : (
                <>
                  <p className="text-xl font-semibold tracking-tight">
                    {formatValue(total)}
                  </p>
                  {isBadgePositive ? (
                    <Badge variant="green">
                      {percentageChange >= 0 ? "+" : ""}
                      {percentageChange.toFixed(0)}%
                    </Badge>
                  ) : (
                    <Badge variant="red">
                      {percentageChange >= 0 ? "+" : ""}
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
        <CardContent className="p-6">
          <Loading
            isLoading={isFetching}
            className="h-[30dvw] md:h-[23dvw] w-full"
          >
            {selectedKpi === "worstPerformingMachines" ? (
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[30dvw] md:h-[23dvw] w-full"
              >
                <BarChart
                  accessibilityLayer
                  layout="vertical"
                  data={kpiFetcher.data?.data ?? []}
                  margin={{ left: 20 }}
                >
                  <CartesianGrid horizontal={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={150}
                  />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) =>
                          `${numberFormatter.format(value as number)} failures`
                        }
                      />
                    }
                  />
                  <Bar dataKey="value" className="fill-red-500" radius={2} />
                </BarChart>
              </ChartContainer>
            ) : (
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[30dvw] md:h-[23dvw] w-full"
              >
                <BarChart accessibilityLayer data={kpiFetcher.data?.data ?? []}>
                  <CartesianGrid vertical={false} />
                  <YAxis
                    dataKey="value"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      if (["mttr", "mtbf"].includes(selectedKpiData.key)) {
                        return formatDurationMilliseconds(
                          (value as number) * 1000,
                          { style: "short" }
                        );
                      }
                      if (["sparePartCost"].includes(selectedKpiData.key)) {
                        return currencyFormatter.format(value as number);
                      }
                      return numberFormatter.format(value as number);
                    }}
                  />
                  <XAxis
                    dataKey={
                      ["week", "month"].includes(interval) ? "date" : "month"
                    }
                    tickLine={false}
                    tickMargin={8}
                    minTickGap={32}
                    axisLine={false}
                    tickFormatter={(value) => {
                      if (!value) return "";
                      return ["week", "month"].includes(interval)
                        ? dateFormatter.format(
                            parseDate(value).toDate(getLocalTimeZone())
                          )
                        : value.slice(0, 3);
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={
                          ["week", "month"].includes(interval)
                            ? (value) =>
                                dateFormatter.format(
                                  parseDate(value).toDate(getLocalTimeZone())
                                )
                            : (value) => (
                                <span className="font-mono">{value}</span>
                              )
                        }
                        formatter={(value) => {
                          if (["mttr", "mtbf"].includes(selectedKpiData.key)) {
                            return formatDurationMilliseconds(
                              (value as number) * 1000
                            );
                          }
                          if (selectedKpiData.key === "sparePartCost") {
                            return currencyFormatter.format(value as number);
                          }
                          return numberFormatter.format(value as number);
                        }}
                      />
                    }
                  />
                  <Bar
                    dataKey="value"
                    className={
                      ["mttr", "mtbf"].includes(selectedKpiData.key)
                        ? "fill-blue-500"
                        : ["sparePartCost", "sparePartConsumption"].includes(
                              selectedKpiData.key
                            )
                          ? "fill-amber-500"
                          : "fill-teal-500"
                    }
                    radius={2}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </Loading>
        </CardContent>
      </Card>
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="px-6 pb-0">
            <CardTitle>Recently Created</CardTitle>
            <CardDescription className="text-sm">
              Newly created maintenance dispatches
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="min-h-[200px] max-h-[360px] w-full overflow-y-auto">
              {recentlyCreated.length > 0 ? (
                <DispatchTable data={recentlyCreated} />
              ) : (
                <div className="flex justify-center items-center h-full">
                  <Empty />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-6 pb-0">
            <CardTitle>Assigned to Me</CardTitle>
            <CardDescription className="text-sm">
              Dispatches currently assigned to you
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 min-h-[200px]">
            <Suspense fallback={<Loading isLoading />}>
              <Await
                resolve={assignedToMe}
                errorElement={<div>Error loading assigned dispatches</div>}
              >
                {(dispatches) =>
                  dispatches.length > 0 ? (
                    <DispatchTable data={dispatches} />
                  ) : (
                    <div className="flex justify-center items-center h-full">
                      <Empty />
                    </div>
                  )
                }
              </Await>
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type DispatchRow = {
  id: string;
  maintenanceDispatchId: string;
  status: (typeof OPEN_STATUSES)[number] | "Completed" | "Cancelled";
  source: (typeof maintenanceSource)[number] | null;
  priority: string | null;
  workCenterId: string | null;
};

function DispatchTable({ data }: { data: DispatchRow[] }) {
  const workCenters = useWorkCenters();

  const getWorkCenterName = (workCenterId: string | null) => {
    if (!workCenterId) return "-";
    const wc = workCenters.find((w) => w.value === workCenterId);
    return wc?.label ?? "-";
  };

  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Dispatch</Th>
          <Th>Status</Th>
          <Th>Source</Th>
          <Th>Work Center</Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.map((dispatch) => (
          <Tr key={dispatch.id}>
            <Td>
              <Hyperlink to={path.to.maintenanceDispatch(dispatch.id)}>
                <HStack spacing={1}>
                  <LuWrench className="size-4" />
                  <span>{dispatch.maintenanceDispatchId}</span>
                </HStack>
              </Hyperlink>
            </Td>
            <Td>
              <MaintenanceStatus status={dispatch.status} />
            </Td>
            <Td>
              <MaintenanceSource
                source={dispatch.source as (typeof maintenanceSource)[number]}
              />
            </Td>
            <Td>{getWorkCenterName(dispatch.workCenterId)}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
