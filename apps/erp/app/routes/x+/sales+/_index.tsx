import { requirePermissions } from "@carbon/auth/auth.server";
import {
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
} from "@carbon/react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@carbon/react/Chart";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { DateRange } from "@react-types/datepicker";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { useState } from "react";
import { LuArrowUpRight, LuChevronDown, LuMoreVertical } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
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

const chartData = [
  { month: "January", desktop: 186, mobile: 80 },
  { month: "February", desktop: 305, mobile: 200 },
  { month: "March", desktop: 237, mobile: 120 },
  { month: "April", desktop: 73, mobile: 190 },
  { month: "May", desktop: 209, mobile: 130 },
  { month: "June", desktop: 214, mobile: 140 },
];

const KPIS = [
  {
    key: "salesOrderRevenue",
    label: "Sales Order Revenue",
  },
  {
    key: "quoteRevenue",
    label: "Quote Revenue",
  },
  {
    key: "salesOrderCount",
    label: "Sales Order Count",
  },
  {
    key: "quoteCount",
    label: "Quote Count",
  },
  {
    key: "rfqCount",
    label: "RFQ Count",
  },
  {
    key: "turnaroundTime",
    label: "Turnaround Time",
  },
];

const CHART_INTERVALS = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
];

const chartConfig = {
  desktop: {
    label: "Desktop",
    color: "hsl(var(--chart-1))", // Primary color
  },
  mobile: {
    label: "Mobile",
    color: "hsl(var(--chart-2))", // Lighter primary
  },
} satisfies ChartConfig;

export default function SalesDashboard() {
  const { openSalesOrders, openQuotes, openRFQs } =
    useLoaderData<typeof loader>();

  const kpiFetcher = useFetcher<{ data: typeof chartData }>();

  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("salesOrderRevenue");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = today(getLocalTimeZone());
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const selectedInterval =
    CHART_INTERVALS.find((i) => i.key === interval) || CHART_INTERVALS[1];
  const selectedKpiData = KPIS.find((k) => k.key === selectedKpi) || KPIS[0];

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
                      {KPIS.map((kpi) => (
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
            </CardHeader>
            <CardAction className="py-6 px-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="secondary"
                    size="sm"
                    icon={<LuMoreVertical />}
                    aria-label="More"
                  />
                </DropdownMenuTrigger>
              </DropdownMenu>
            </CardAction>
          </HStack>
          <CardContent className="p-4">
            <Loading
              isLoading={kpiFetcher.state === "loading"}
              className="h-[30dvw] md:h-[20dvw] w-full"
            >
              <ChartContainer
                config={chartConfig}
                className="h-[30dvw] md:h-[20dvw] w-full"
              >
                <BarChart accessibilityLayer data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={(value) => value.slice(0, 3)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="desktop"
                    fill="var(--color-desktop)"
                    radius={4}
                  />
                  <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
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
          <CardContent className="p-4 min-h-[200px]">
            <Loading isLoading>
              <p>Hello</p>
            </Loading>
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
        <CardContent className="p-4 min-h-[200px]"></CardContent>
      </Card>
    </div>
  );
}
