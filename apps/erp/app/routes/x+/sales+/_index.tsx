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
  DateRangePicker,
  DropdownMenu,
  DropdownMenuContent,
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
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { useEffect, useState } from "react";
import { LuArrowUpRight, LuChevronDown, LuMoreVertical } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { KPIs } from "~/modules/sales/sales.models";
import type { loader as kpiLoader } from "~/routes/api+/sales.kpi.$key";
import { path } from "~/utils/path";

const OPEN_RFQ_STATUSES = ["Ready for Quote", "Draft"];
const OPEN_QUOTE_STATUSES = ["Sent", "Draft"];
const OPEN_SALES_ORDER_STATUSES = [
  "Confirmed",
  "Needs Approval",
  "In Progress",
  "Draft",
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const [openSalesOrders, openQuotes, openRFQs] = await Promise.all([
    client
      .from("salesOrder")
      .select("id, salesOrderId, customerId, assignee", { count: "exact" })
      .in("status", OPEN_SALES_ORDER_STATUSES),
    client
      .from("quote")
      .select("id, quoteId, customerId, assignee", { count: "exact" })
      .in("status", OPEN_QUOTE_STATUSES),
    client
      .from("salesRfq")
      .select("id, salesRfqId, customerId, assignee", { count: "exact" })
      .in("status", OPEN_RFQ_STATUSES),
  ]);

  return json({
    openSalesOrders: openSalesOrders,
    openQuotes: openQuotes,
    openRFQs: openRFQs,
  });
}

const CHART_INTERVALS = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
];

const chartConfig = {
  now: {
    color: "hsl(var(--chart-1))", // Primary color
  },
} satisfies ChartConfig;

export default function SalesDashboard() {
  const { openSalesOrders, openQuotes, openRFQs } =
    useLoaderData<typeof loader>();

  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const isFetching = kpiFetcher.state !== "idle" || !kpiFetcher.data;

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric",
  });

  const { company } = useUser();

  const currencyFormatter = useCurrencyFormatter(company.baseCurrencyCode, 0);
  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short",
  });

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("salesOrderRevenue");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = today(getLocalTimeZone());
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedInterval =
    CHART_INTERVALS.find((i) => i.key === interval) || CHART_INTERVALS[1];
  const selectedKpiData = KPIs.find((k) => k.key === selectedKpi) || KPIs[0];

  useEffect(() => {
    kpiFetcher.load(
      `${path.to.api.salesKpi(
        selectedKpiData.key
      )}?start=${dateRange?.start.toString()}&end=${dateRange?.end.toString()}&interval=${interval}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKpi, dateRange, interval, selectedKpiData.key]);

  const onIntervalChange = (value: string) => {
    const end = today(getLocalTimeZone());
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
    kpiFetcher.data?.data.reduce((acc, curr) => acc + curr.value, 0) ?? 0;
  const previousTotal =
    kpiFetcher.data?.previousPeriodData.reduce(
      (acc, curr) => acc + curr.value,
      0
    ) ?? 0;
  const percentageChange =
    previousTotal === 0
      ? total > 0
        ? 100
        : 0
      : ((total - previousTotal) / previousTotal) * 100;

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="p-4 rounded-xl items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
              <RiProgress2Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.salesRfqs
                }?filter=status:in:${OPEN_RFQ_STATUSES.join(",")}`}
              >
                View RFQs
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openRFQs.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open RFQs
            </p>
          </div>
        </Card>

        <Card className="p-4 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
              <RiProgress4Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
            >
              <Link
                to={`${
                  path.to.quotes
                }?filter=status:in:${OPEN_QUOTE_STATUSES.join(",")}`}
              >
                View Quotes
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openQuotes.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Quotes
            </p>
          </div>
        </Card>

        <Card className="p-4 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
              <RiProgress8Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
              asChild
            >
              <Link
                to={`${
                  path.to.salesOrders
                }?filter=status:in:${OPEN_SALES_ORDER_STATUSES.join(",")}`}
              >
                View Orders
              </Link>
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">
              {openSalesOrders.count ?? 0}
            </h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Sales Orders
            </p>
          </div>
        </Card>
      </div>

      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card className="p-0">
          <HStack className="justify-between items-start">
            <CardHeader className="px-4 pb-0">
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
                      {CHART_INTERVALS.map((i) => (
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
                    <p>
                      {["salesOrderRevenue"].includes(selectedKpiData.key)
                        ? currencyFormatter.format(total)
                        : numberFormatter.format(total)}
                    </p>
                    <Badge
                      variant="secondary"
                      className="normal-case font-medium px-2 rounded-full"
                    >
                      {percentageChange > 0
                        ? `+${percentageChange.toFixed(0)}%`
                        : `${percentageChange.toFixed(0)}%`}
                    </Badge>
                  </>
                )}
              </HStack>
            </CardHeader>
            <CardAction className="py-6 px-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="secondary"
                    icon={<LuMoreVertical />}
                    aria-label="More"
                  />
                </DropdownMenuTrigger>
              </DropdownMenu>
            </CardAction>
          </HStack>
          <CardContent className="p-4">
            <Loading
              isLoading={isFetching}
              className="h-[30dvw] md:h-[23dvw] w-full"
            >
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[30dvw] md:h-[23dvw] w-full"
              >
                <BarChart accessibilityLayer data={kpiFetcher.data?.data ?? []}>
                  <CartesianGrid vertical={false} />
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
                            : (value) => value
                        }
                        formatter={(value) =>
                          ["salesOrderRevenue"].includes(selectedKpiData.key)
                            ? currencyFormatter.format(value as number)
                            : numberFormatter.format(value as number)
                        }
                      />
                    }
                  />
                  <Bar dataKey="value" fill="var(--color-now)" radius={2} />
                </BarChart>
              </ChartContainer>
            </Loading>
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="px-4 pb-0">
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription className="text-sm">
              Newly created sales documents
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-[30dvw] md:h-[23dvw] w-full overflow-y-auto">
              {/* TODO: Add recent activity */}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="p-0">
        <CardHeader className="px-4">
          <CardTitle>Assigned to Me</CardTitle>
          <CardDescription className="text-sm">
            Sales documents currently assigned to me
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 min-h-[200px]">
          {/* TODO: Add assigned to me */}
        </CardContent>
      </Card>
    </div>
  );
}
