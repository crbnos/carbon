import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import {
  LuArrowUpRight,
  LuCalendarClock,
  LuChevronDown,
  LuCircleAlert,
  LuClipboardList,
  LuClock,
  LuEllipsisVertical,
  LuFile,
  LuInbox,
  LuShieldCheck,
  LuShieldX
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Await, Link, useFetcher, useLoaderData } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis
} from "recharts";
import { DateSelect, Empty, Hyperlink } from "~/components";
import { getIssueTypesList, QualityKPIs } from "~/modules/quality";
import IssueStatus from "~/modules/quality/ui/Issue/IssueStatus";
import { getCompanySettings } from "~/modules/settings";
import type { loader as kpiLoader } from "~/routes/api+/quality.kpi.$key";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Dashboard`,
  to: path.to.quality
};

const OPEN_ISSUE_STATUSES = ["Registered", "In Progress"] as const;

const categoryKeys = new Set([
  "type",
  "status",
  "criticality",
  "priority",
  "week"
]);

function StackedBar(props: unknown): JSX.Element {
  const { x, y, width, height, fill } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
  };
  if (!height || height <= 0 || !width || width <= 0) return <g />;
  const gap = 2;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={Math.max(height - gap, 0)}
      fill={fill}
      rx={2}
    />
  );
}

function percentageFormatter(
  value: unknown,
  _name: unknown,
  item: { payload?: Record<string, unknown> }
) {
  if (Array.isArray(value)) return `${value.join(", ")}`;
  const row = item?.payload;
  const total = row
    ? Object.entries(row)
        .filter(([k]) => !categoryKeys.has(k))
        .reduce((sum, [, v]) => sum + (typeof v === "number" ? v : 0), 0)
    : 0;
  const pct = total > 0 ? Math.round(((value as number) / total) * 100) : 0;
  return `${value} (${pct}%)`;
}

const qualityChartConfig = {
  Critical: { label: "Critical", color: "hsl(var(--destructive))" },
  High: { label: "High", color: "hsl(var(--chart-5))" },
  Medium: { label: "Medium", color: "hsl(var(--chart-1))" },
  Low: { label: "Low", color: "hsl(var(--success))" },
  Registered: { label: "Registered", color: "hsl(var(--chart-5))" },
  "In Progress": { label: "In Progress", color: "hsl(var(--chart-1))" },
  Closed: { label: "Closed", color: "hsl(var(--success))" },
  opened: { label: "Opened", color: "hsl(var(--chart-5))" },
  closed: { label: "Closed", color: "hsl(var(--success))" },
  target: { label: "Target", color: "hsl(var(--destructive))" },
  count: { label: "Count" },
  cumulative: { label: "Cumulative %", color: "hsl(var(--chart-5))" },
  Internal: { label: "Internal", color: "hsl(var(--chart-1))" },
  External: { label: "External", color: "hsl(var(--chart-5))" },
  "0-4 weeks": { label: "0-4 weeks", color: "hsl(var(--success))" },
  "5-8 weeks": { label: "5-8 weeks", color: "hsl(var(--chart-4))" },
  "9-12 weeks": { label: "9-12 weeks", color: "hsl(var(--chart-5))" },
  "13+ weeks": { label: "13+ weeks", color: "hsl(var(--destructive))" }
} satisfies ChartConfig;

const weeklyLegendPayload = [
  {
    value: "Opened",
    dataKey: "opened",
    type: "square" as const,
    color: qualityChartConfig.opened.color
  },
  {
    value: "Closed",
    dataKey: "closed",
    type: "square" as const,
    color: qualityChartConfig.closed.color
  },
  {
    value: "Target",
    dataKey: "target",
    type: "line" as const,
    color: "hsl(var(--destructive))"
  }
];

function formatWeekLabel(weekKey: string, locale?: string): string {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekKey;
  const year = Number.parseInt(match[1]);
  const week = Number.parseInt(match[2]);
  const d = new Date(Date.UTC(year, 0, 4));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7) + 1 + (week - 1) * 7);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const [
    openIssues,
    uncontainedIssues,
    containedIssues,
    openActions,
    issueTypes,
    companySettings,
    recentlyCreated
  ] = await Promise.all([
    client
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .in("status", ["Registered", "In Progress"]),
    client
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .in("status", ["Registered", "In Progress"])
      .eq("containmentStatus", "Uncontained"),
    client
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .in("status", ["Registered", "In Progress"])
      .eq("containmentStatus", "Contained"),
    client
      .from("nonConformanceActionTask")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .in("status", ["Pending", "In Progress"]),
    getIssueTypesList(client, companyId),
    getCompanySettings(client, companyId),
    client
      .from("issues")
      .select("id, nonConformanceId, name, status, priority, createdAt")
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .limit(10)
  ]);

  const assignedToMe = client
    .from("issues")
    .select("id, nonConformanceId, name, status, priority")
    .eq("companyId", companyId)
    .eq("assignee", userId)
    .in("status", ["Registered", "In Progress"])
    .order("createdAt", { ascending: false })
    .limit(10)
    .then((result) => result.data ?? []);

  return {
    openIssuesCount: openIssues.count ?? 0,
    uncontainedCount: uncontainedIssues.count ?? 0,
    containedCount: containedIssues.count ?? 0,
    openActionsCount: openActions.count ?? 0,
    issueTypes: issueTypes.data ?? [],
    qualityIssueTarget: companySettings.data?.qualityIssueTarget,
    recentlyCreated: recentlyCreated.data ?? [],
    assignedToMe
  };
}

// --- Priority Helpers ---

function getPriorityVariant(priority: string | null) {
  switch (priority) {
    case "Critical":
      return "red";
    case "High":
      return "orange";
    case "Medium":
      return "yellow";
    case "Low":
      return "green";
    default:
      return "gray";
  }
}

// --- Component ---

export default function QualityDashboard() {
  const {
    openIssuesCount,
    containedCount,
    openActionsCount,
    issueTypes,
    qualityIssueTarget,
    recentlyCreated,
    assignedToMe
  } = useLoaderData<typeof loader>();

  const { t } = useLingui();
  const { locale } = useLocale();
  const [selectedChart, setSelectedChart] = useState("weeklyTracking");
  const [interval, setInterval] = useState("month");
  const [issueTypeId, setIssueTypeId] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = today("UTC");
    const start = end.add({ months: -1 });
    return { start, end };
  });

  const kpiFetcher = useFetcher<typeof kpiLoader>();
  const avgFetcher = useFetcher<typeof kpiLoader>();

  const selectedChartData =
    QualityKPIs.find((c) => c.key === selectedChart) || QualityKPIs[0];

  const kpiLabels: Record<string, string> = useMemo(
    () => ({
      weeklyTracking: t`Issue Trend`,
      statusDistribution: t`Status Distribution`,
      paretoByType: t`Pareto by Type`,
      ncrsByType: t`NCRs by Type`,
      sourceAnalysis: t`Source Analysis`,
      supplierQuality: t`Supplier Quality`,
      weeksOpen: t`Weeks Open`
    }),
    [t]
  );

  const typeOptions = useMemo(() => {
    return [
      { label: t`All Types`, value: "all" },
      ...issueTypes.map((type) => ({ label: type.name, value: type.id }))
    ];
  }, [issueTypes, t]);

  const onIntervalChange = (value: string) => {
    const end = today("UTC");
    if (value === "week") {
      setDateRange({ start: end.add({ days: -7 }), end });
    } else if (value === "month") {
      setDateRange({ start: end.add({ months: -1 }), end });
    } else if (value === "quarter") {
      setDateRange({ start: end.add({ months: -3 }), end });
    } else if (value === "year") {
      setDateRange({ start: end.add({ years: -1 }), end });
    }
    setInterval(value);
  };

  // Fetch chart data when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: don't include the load functions
  useEffect(() => {
    if (!dateRange?.start || !dateRange?.end) return;
    const params = `?start=${dateRange.start.toString()}&end=${dateRange.end.toString()}&interval=${interval}${
      issueTypeId === "all" ? "" : `&issueTypeId=${issueTypeId}`
    }`;
    kpiFetcher.load(path.to.api.qualityKpi(selectedChart) + params);
    avgFetcher.load(path.to.api.qualityKpi("avgDaysToClose") + params);
  }, [selectedChart, dateRange, interval, issueTypeId]);

  const avgDaysToClose = (avgFetcher.data?.data as any)?.[0]?.value ?? null;

  // CSV export
  const csvData = useMemo(() => {
    const data = kpiFetcher.data?.data;
    if (!data || !Array.isArray(data) || data.length === 0) return [];
    const keys = Object.keys(data[0]);
    return [keys, ...data.map((d: any) => keys.map((k) => d[k]))];
  }, [kpiFetcher.data?.data]);

  const csvFilename = useMemo(() => {
    const startDate = dateRange?.start.toString();
    const endDate = dateRange?.end.toString();
    return `${(kpiLabels[selectedChartData.key] ?? "").replace(/ /g, "_")}_${startDate}_to_${endDate}.csv`;
  }, [dateRange, kpiLabels, selectedChartData.key]);

  // Chart data from fetcher
  const chartData = kpiFetcher.data?.data ?? [];

  // Target: prefer meta value from API, fall back to loader value
  const effectiveTarget =
    (kpiFetcher.data as any)?.meta?.qualityIssueTarget ?? qualityIssueTarget;

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      {/* KPI Cards */}
      <div className="grid w-full gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row gap-2">
            <LuCircleAlert className="text-muted-foreground" />
            <CardTitle>
              <Trans>Open Issues</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {openIssuesCount}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${path.to.issues}?filter=status:in:${OPEN_ISSUE_STATUSES.join(",")}`}
                >
                  <Trans>View</Trans>
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuShieldCheck className="text-muted-foreground" />
            <CardTitle>
              <Trans>Contained</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {containedCount}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${path.to.issues}?filter=containmentStatus:eq:Contained`}
                >
                  <Trans>View</Trans>
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuClipboardList className="text-muted-foreground" />
            <CardTitle>
              <Trans>Open Actions</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {openActionsCount}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${path.to.qualityActions}?filter=status:in:Pending,In Progress`}
                >
                  <Trans>View</Trans>
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuCalendarClock className="text-muted-foreground" />
            <CardTitle>
              <Trans>Avg Days to Close</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-5xl font-medium tracking-tighter">
              {avgDaysToClose !== null ? avgDaysToClose : "—"}
            </h3>
            <span className="text-xs text-muted-foreground">
              <Trans>in selected period</Trans>
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Unified Chart Card */}
      <Card>
        <HStack className="justify-between items-center">
          <CardHeader>
            <div className="flex w-full justify-start items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                    className="hover:bg-background/80"
                  >
                    <span>{kpiLabels[selectedChartData.key]}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start">
                  <DropdownMenuRadioGroup
                    value={selectedChart}
                    onValueChange={setSelectedChart}
                  >
                    {QualityKPIs.map((chart) => (
                      <DropdownMenuRadioItem key={chart.key} value={chart.key}>
                        {kpiLabels[chart.key]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Combobox
                asButton
                value={issueTypeId}
                onChange={setIssueTypeId}
                options={typeOptions}
                size="sm"
                className="font-medium text-sm min-w-[160px]"
              />
            </div>
          </CardHeader>
          <CardAction className="flex-row items-center gap-2">
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
        <CardContent className="flex-col gap-4">
          <div className="h-[30dvw] md:h-[23dvw] min-h-[300px]">
            {selectedChart === "weeklyTracking" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <ComposedChart data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="week"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatWeekLabel(v, locale)}
                    minTickGap={32}
                  />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(v) => formatWeekLabel(v, locale)}
                      />
                    }
                  />
                  <ChartLegend
                    payload={weeklyLegendPayload}
                    content={<ChartLegendContent />}
                  />
                  {effectiveTarget > 0 && (
                    <ReferenceLine
                      y={effectiveTarget}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="3 3"
                      label={{
                        value: "Target",
                        position: "insideTopLeft",
                        fill: "hsl(var(--destructive))",
                        fontSize: 12
                      }}
                    />
                  )}
                  <Bar
                    dataKey="opened"
                    fill="var(--color-opened)"
                    maxBarSize={48}
                    radius={2}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="closed"
                    fill="var(--color-closed)"
                    maxBarSize={48}
                    radius={2}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            )}

            {selectedChart === "statusDistribution" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="50%"
                    outerRadius="80%"
                    paddingAngle={2}
                    isAnimationActive={false}
                  >
                    {(chartData as any[]).map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          const total = (chartData as any[]).reduce(
                            (s, d) => s + d.value,
                            0
                          );
                          return (
                            <text
                              x={viewBox.cx}
                              y={viewBox.cy}
                              textAnchor="middle"
                            >
                              <tspan
                                x={viewBox.cx}
                                y={viewBox.cy}
                                className="fill-foreground text-3xl font-bold"
                              >
                                {total}
                              </tspan>
                              <tspan
                                x={viewBox.cx}
                                y={(viewBox.cy ?? 0) + 20}
                                className="fill-muted-foreground text-xs"
                              >
                                {t`Total`}
                              </tspan>
                            </text>
                          );
                        }
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}

            {selectedChart === "paretoByType" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <ComposedChart data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    yAxisId="left"
                    dataKey="count"
                    fill="hsl(var(--chart-1))"
                    maxBarSize={48}
                    radius={2}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulative"
                    stroke="var(--color-cumulative)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            )}

            {selectedChart === "ncrsByType" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent formatter={percentageFormatter} />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="Critical"
                    fill="var(--color-Critical)"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="High"
                    fill="var(--color-High)"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Medium"
                    fill="var(--color-Medium)"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Low"
                    fill="var(--color-Low)"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}

            {selectedChart === "sourceAnalysis" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="priority"
                    tickLine={false}
                    axisLine={false}
                    width={80}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent formatter={percentageFormatter} />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="Internal"
                    fill="var(--color-Internal)"
                    stackId="stack"
                    maxBarSize={32}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="External"
                    fill="var(--color-External)"
                    stackId="stack"
                    maxBarSize={32}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}

            {selectedChart === "supplierQuality" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                {(chartData as any[]).length > 0 ? (
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ left: 20 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={120}
                      tick={{ fontSize: 12 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="count"
                      fill="hsl(var(--chart-1))"
                      maxBarSize={28}
                      radius={2}
                      isAnimationActive={false}
                    />
                  </BarChart>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Empty />
                  </div>
                )}
              </ChartContainer>
            )}

            {selectedChart === "weeksOpen" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="criticality"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent formatter={percentageFormatter} />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="0-4 weeks"
                    fill="hsl(var(--success))"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="5-8 weeks"
                    fill="hsl(var(--chart-4))"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="9-12 weeks"
                    fill="hsl(var(--chart-5))"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="13+ weeks"
                    fill="hsl(var(--destructive))"
                    stackId="stack"
                    maxBarSize={48}
                    radius={2}
                    shape={StackedBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recently Created + Assigned to Me */}
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row gap-2">
            <LuClock className="text-muted-foreground" />
            <CardTitle>
              <Trans>Recently Created</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="min-h-[200px] max-h-[360px] w-full overflow-y-auto">
              {recentlyCreated.length > 0 ? (
                <IssueTable data={recentlyCreated} />
              ) : (
                <div className="flex justify-center items-center h-full">
                  <Empty />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuInbox className="text-muted-foreground" />
            <CardTitle>
              <Trans>Assigned to Me</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-[200px]">
            <Suspense
              fallback={
                <div className="p-4 text-muted-foreground">
                  <Trans>Loading...</Trans>
                </div>
              }
            >
              <Await
                resolve={assignedToMe}
                errorElement={
                  <div>
                    <Trans>Error loading assigned issues</Trans>
                  </div>
                }
              >
                {(assignedIssues) =>
                  assignedIssues.length > 0 ? (
                    <IssueTable data={assignedIssues} />
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

// --- Issue Table ---

function IssueTable({
  data
}: {
  data: {
    id: string | null;
    nonConformanceId: string | null;
    status: string | null;
    priority: string | null;
  }[];
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Issue</Trans>
          </Th>
          <Th>
            <Trans>Status</Trans>
          </Th>
          <Th>
            <Trans>Priority</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.map((issue) => {
          if (!issue.id) return null;
          return (
            <Tr key={issue.id}>
              <Td>
                <Hyperlink to={path.to.issue(issue.id)}>
                  <HStack spacing={1}>
                    <LuShieldX className="size-4" />
                    <span>{issue.nonConformanceId}</span>
                  </HStack>
                </Hyperlink>
              </Td>
              <Td>
                <IssueStatus
                  status={
                    issue.status as
                      | "Registered"
                      | "In Progress"
                      | "Closed"
                      | null
                  }
                />
              </Td>
              <Td>
                {issue.priority && (
                  <Badge
                    variant={
                      getPriorityVariant(issue.priority) as
                        | "red"
                        | "orange"
                        | "yellow"
                        | "green"
                        | "gray"
                    }
                  >
                    {issue.priority}
                  </Badge>
                )}
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
