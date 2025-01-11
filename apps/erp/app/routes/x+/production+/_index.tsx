import {
  Badge,
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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@carbon/react/Chart";
import { formatDurationMilliseconds } from "@carbon/utils";
import { now, toCalendarDateTime } from "@internationalized/date";
import { useNumberFormatter } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import { LuChevronDown, LuEllipsisVertical, LuFile } from "react-icons/lu";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { KPIs } from "~/modules/production";
import { chartIntervals } from "~/modules/shared";
import type { loader as kpiLoader } from "~/routes/api+/production.kpi.$key";
import { path } from "~/utils/path";

const chartConfig = {
  actual: {
    color: "hsl(var(--primary))", // Primary color
  },
  estimate: {
    color: "hsl(var(--chart-2))", // Secondary color
  },
} satisfies ChartConfig;

export default function ProductionDashboard() {
  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const isFetching = kpiFetcher.state !== "idle" || !kpiFetcher.data;

  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short",
  });

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("utilization");
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

  const total =
    kpiFetcher.data?.data?.reduce((acc, item) => {
      return acc + item.value;
    }, 0) ?? 0;
  const previousTotal =
    kpiFetcher.data?.previousPeriodData?.reduce((acc, item) => {
      return acc + item.value;
    }, 0) ?? 0;
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
          ["Work Center", "Utilization"],
          ...kpiFetcher.data.data.map((item) => [
            item.key,
            item.value / totalTimeInInterval,
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
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="col-span-3 p-0">
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
                    <Badge
                      variant="secondary"
                      className="normal-case font-medium px-2 rounded-full"
                    >
                      {percentageChange > 0
                        ? `+${percentageChange.toFixed(0)}%`
                        : `-${percentageChange.toFixed(0)}%`}
                    </Badge>
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
            <Loading isLoading={isFetching} className="w-full">
              <ChartContainer
                config={chartConfig}
                style={{
                  height: `${(kpiFetcher.data?.data?.length ?? 5) * 40}px`,
                }}
              >
                <BarChart
                  accessibilityLayer
                  data={kpiFetcher.data?.data ?? []}
                  layout="vertical"
                  margin={{
                    left: -20,
                  }}
                >
                  <YAxis
                    dataKey="key"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={yAxisWidth}
                  />
                  <XAxis type="number" dataKey="value" hide />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => {
                          const percentage =
                            totalTimeInInterval === 0
                              ? "0.00"
                              : (
                                  ((value as number) / totalTimeInInterval) *
                                  100
                                ).toFixed(2);
                          return (
                            <div className="flex flex-col gap-1">
                              <div className="font-medium">{percentage}%</div>
                              <div>
                                {formatDurationMilliseconds(value as number)}
                              </div>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <Bar dataKey="value" fill="var(--color-actual)" radius={2} />
                </BarChart>
              </ChartContainer>
            </Loading>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
