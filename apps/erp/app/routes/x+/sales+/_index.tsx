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
} from "@carbon/react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@carbon/react/Chart";
import type { DateRange } from "@react-types/datepicker";
import { useState } from "react";
import { LuArrowUpRight, LuChevronDown, LuMoreVertical } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

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
    color: "hsl(var(--primary))", // Primary color
  },
  mobile: {
    label: "Mobile",
    color: "hsl(var(--chart-1))", // Lighter primary
  },
} satisfies ChartConfig;

export default function SalesDashboard() {
  const [interval, setInterval] = useState("month");
  const [selectedKpi, setSelectedKpi] = useState("salesOrderRevenue");
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  const selectedInterval =
    CHART_INTERVALS.find((i) => i.key === interval) || CHART_INTERVALS[1];
  const selectedKpiData = KPIS.find((k) => k.key === selectedKpi) || KPIS[0];

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
            >
              View RFQs
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">42</h3>
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
              View Quotes
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">12</h3>
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
            >
              View Orders
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">3</h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Sales Orders
            </p>
          </div>
        </Card>
      </div>

      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="col-span-2 p-0">
          <HStack className="justify-between items-start">
            <CardHeader className="px-4">
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
                      <span>{selectedInterval.label}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="start">
                    <DropdownMenuRadioGroup
                      value={interval}
                      onValueChange={setInterval}
                    >
                      {CHART_INTERVALS.map((i) => (
                        <DropdownMenuRadioItem key={i.key} value={i.key}>
                          {i.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {interval === "custom" && (
                  <DateRangePicker
                    size="md"
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
            <ChartContainer
              config={chartConfig}
              className="min-h-[200px] w-full"
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
                <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
                <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="px-4">
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription className="text-sm">
              Newly created sales documents
            </CardDescription>
          </CardHeader>
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
