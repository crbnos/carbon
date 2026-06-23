import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  Input,
  Loading,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useMount,
  VStack
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import { ChartContainer, ChartLegend, ChartTooltip } from "@carbon/react/Chart";

import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import { type CSSProperties, useMemo, useState } from "react";
import {
  LuChartLine,
  LuCircleCheck,
  LuClipboardList,
  LuCrown,
  LuFactory,
  LuInfo,
  LuMoveDown,
  LuMoveUp,
  LuSearch,
  LuShoppingCart,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis
} from "recharts";
import { Empty, Hyperlink } from "~/components";
import { useDateFormatter as useDateFormat } from "~/hooks";
import type { DemandForecastSourceRow } from "~/modules/items/items.service";
import type { loader as forecastLoader } from "~/routes/api+/items.$id.$locationId.forecast";
import { path } from "~/utils/path";
import type { PlannedOrder } from "../../../purchasing/purchasing.models";
import { DemandForecastSourcesPopover } from "./DemandForecastSourcesPopover";
import { PlannedOrderDetailsPopover } from "./PlannedOrderDetailsPopover";

const supplySourceTypes = ["Purchase Order", "Production Order"] as const;
const demandSourceTypes = ["Sales Order", "Job Material"] as const;

type SourceType =
  | (typeof supplySourceTypes)[number]
  | (typeof demandSourceTypes)[number]
  | "Planned"
  | "Demand Forecast";

interface ChartDataPoint {
  startDate: string;
  period: string;
  "Sales Order": number;
  "Job Material": number;
  "Purchase Order": number;
  "Production Order": number;
  Planned: number;
  Projection: number;
  "Demand Forecast": number;
}

// Single source of truth for series colors. Theme-aware (CSS vars) so the chart
// adapts to light/dark and the active theme. The diverging convention is:
// supply pushes inventory UP (cool), demand pulls it DOWN (warm). The same
// mapping is reused by the summary cards and the supply/demand list below, so a
// color never means "supply" in one place and "demand" two inches away.
const chartColors = {
  supply: "hsl(var(--success))",
  planned: "hsl(var(--chart-2))",
  demand: "hsl(var(--destructive))",
  demandForecast: "hsl(var(--chart-5))",
  projection: "hsl(var(--primary))",
  // Violet theme token (--chart-6, light/dark variants in tailwind.css): kept out
  // of the warm family so the safety-stock threshold is easy to read and never
  // confused with the orange Demand Forecast bars (--chart-5).
  safety: "hsl(var(--chart-6))",
  zero: "hsl(var(--muted-foreground))"
} as const;

// Round a value to a "nice" number (1/2/5 × 10^n) so axis steps land on
// human-friendly intervals instead of arbitrary fractions of the data range.
function niceNum(value: number, round: boolean) {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

// Build evenly-spaced, round Y-axis ticks (and matching domain bounds) that
// cover [min,max] and always include 0. Steps are >=1 since quantities are whole.
function niceAxis(min: number, max: number, tickCount = 6) {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    lo = Math.min(0, lo || 0);
    hi = Math.max(1, hi || 1);
  }
  const step = Math.max(
    1,
    niceNum((hi - lo) / Math.max(1, tickCount - 1), true)
  );
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v));
  }
  return { niceMin, niceMax, ticks };
}

export const ItemPlanningChart = ({
  compact = false,
  itemId,
  locationId,
  plannedOrders = [],
  safetyStock,
  conversionFactor = 1
}: {
  compact?: boolean;
  itemId: string;
  locationId: string;
  plannedOrders?: PlannedOrder[];
  safetyStock?: number;
  conversionFactor?: number;
}) => {
  const { t } = useLingui();
  const forecastFetcher = useFetcher<typeof forecastLoader>();
  const isFetching = forecastFetcher.state !== "idle" || !forecastFetcher.data;
  const [searchTerm, setSearchTerm] = useState("");

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric"
  });

  const numberFormatter = useNumberFormatter();

  useMount(() => {
    forecastFetcher.load(path.to.api.itemForecast(itemId, locationId));
  });

  const hasSafetyStock = typeof safetyStock === "number" && safetyStock > 0;
  const safetyStockValue = hasSafetyStock ? safetyStock : 0;

  const chartData = useMemo(() => {
    const empty = {
      data: [] as ChartDataPoint[],
      stockoutDate: null as string | null,
      belowSafetyDate: null as string | null,
      domainMin: 0,
      domainMax: 0,
      ticks: [] as number[]
    };
    if (
      !forecastFetcher.data?.demand ||
      !forecastFetcher.data?.periods ||
      forecastFetcher.data.periods.length === 0
    )
      return empty;

    const periods = forecastFetcher.data.periods;
    const demand = forecastFetcher.data.demand;
    const demandForecast = forecastFetcher.data.demandForecast ?? [];
    const supply = forecastFetcher.data.supply;
    let currentQuantity = forecastFetcher.data.quantityOnHand ?? 0;

    // Initialize all periods with zero values
    const groupedData = periods.reduce(
      (acc: Record<string, ChartDataPoint>, period) => {
        acc[period.id] = {
          period: period.id,
          startDate: period.startDate,
          "Sales Order": 0,
          "Job Material": 0,
          "Purchase Order": 0,
          "Production Order": 0,
          Planned: 0,
          Projection: currentQuantity, // Initialize with current quantity
          "Demand Forecast": 0
        };
        return acc;
      },
      {}
    );

    // Add projected orders
    plannedOrders.forEach((order) => {
      let periodId = periods.find(
        (p) =>
          new Date(p.startDate) <= new Date(order.dueDate ?? "") &&
          new Date(p.endDate) >= new Date(order.dueDate ?? "")
      )?.id;

      // No exact period match. Clamp past-due / no-date orders to the first
      // week (they affect near-term stock), but DROP orders due beyond the
      // chart horizon — adding them to week 1 would inflate today's projection
      // and could mask a near-term stockout.
      if (!periodId || !order.dueDate) {
        if (periods.length === 0) return;
        const due = order.dueDate ? new Date(order.dueDate) : null;
        const lastEnd = new Date(periods[periods.length - 1].endDate);
        if (due && due > lastEnd) return;
        periodId = periods[0].id;
      }

      if (groupedData[periodId]) {
        // Convert purchase quantity to inventory quantity for display
        // Inventory Quantity = Purchase Quantity × Conversion Factor
        const purchaseQuantityDelta =
          (order.quantity ?? 0) - (order.existingQuantity ?? 0);
        const inventoryQuantityDelta = purchaseQuantityDelta * conversionFactor;

        // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
        groupedData[periodId]["Planned"] += inventoryQuantityDelta;
      }
    });

    // Add demand data
    demand.forEach((curr) => {
      if (
        groupedData[curr.periodId] &&
        curr.sourceType &&
        curr.actualQuantity
      ) {
        const sourceType = curr.sourceType as keyof ChartDataPoint;
        if (sourceType === "Sales Order" || sourceType === "Job Material") {
          groupedData[curr.periodId][sourceType] = -(curr.actualQuantity ?? 0);
        }
      }
    });

    // Add supply data
    supply.forEach((curr) => {
      if (
        groupedData[curr.periodId] &&
        curr.sourceType &&
        curr.actualQuantity
      ) {
        const sourceType = curr.sourceType as keyof ChartDataPoint;
        if (
          sourceType === "Purchase Order" ||
          sourceType === "Production Order"
        ) {
          groupedData[curr.periodId][sourceType] = curr.actualQuantity ?? 0;
        }
      }
    });

    // Add demand forecast data
    demandForecast.forEach((forecast) => {
      if (groupedData[forecast.periodId] && forecast.forecastQuantity) {
        groupedData[forecast.periodId]["Demand Forecast"] = -(
          forecast.forecastQuantity ?? 0
        );
      }
    });

    // Calculate running projection
    let runningProjection = currentQuantity;
    const sortedData = Object.values(groupedData).sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    // Track the first period the projection breaches each threshold, plus the
    // Y range, so the chart can highlight "when do we run short" and the axis
    // can leave headroom around the line.
    let stockoutDate: string | null = null;
    let belowSafetyDate: string | null = null;
    let domainMin = Math.min(0, currentQuantity);
    let domainMax = Math.max(0, currentQuantity, safetyStockValue);

    const data = sortedData.map((period) => {
      // Add supply (positive), then subtract demand (already stored negative).
      const supplyUp =
        period["Purchase Order"] + period["Production Order"] + period.Planned;
      const demandDown =
        period["Sales Order"] +
        period["Job Material"] +
        period["Demand Forecast"];
      runningProjection += supplyUp + demandDown;
      period.Projection = runningProjection;

      if (stockoutDate === null && runningProjection < 0)
        stockoutDate = period.startDate;
      if (
        belowSafetyDate === null &&
        hasSafetyStock &&
        runningProjection < safetyStockValue
      )
        belowSafetyDate = period.startDate;

      domainMax = Math.max(domainMax, runningProjection, supplyUp);
      domainMin = Math.min(domainMin, runningProjection, demandDown);
      return period;
    });

    // Snap the axis to round, evenly-spaced ticks (0 always included) so the
    // Y labels read cleanly instead of arbitrary fractions of the data range.
    const { niceMin, niceMax, ticks } = niceAxis(domainMin, domainMax, 6);
    return {
      data,
      stockoutDate,
      belowSafetyDate,
      domainMin: niceMin,
      domainMax: niceMax,
      ticks
    };
  }, [
    forecastFetcher.data,
    plannedOrders,
    conversionFactor,
    hasSafetyStock,
    safetyStockValue
  ]);

  const combinedSupplyAndDemand = useMemo(() => {
    let projectedQuantity = forecastFetcher.data?.quantityOnHand ?? 0;
    const periods = forecastFetcher.data?.periods ?? [];

    // First get all forecast data
    const forecastData = [
      ...(forecastFetcher.data?.openSalesOrderLines ?? []).map((line) => ({
        ...line,
        sourceType: "Sales Order" as SourceType,
        quantity: line.quantity ?? 0
      })),
      ...(forecastFetcher.data?.openJobMaterials ?? []).map((line) => ({
        ...line,
        sourceType: "Job Material" as SourceType,
        quantity: line.quantity ?? 0
      })),
      ...(forecastFetcher.data?.openPurchaseOrderLines ?? []).map((line) => ({
        ...line,
        sourceType: "Purchase Order" as SourceType,
        quantity: line.quantity ?? 0
      })),
      ...(forecastFetcher.data?.openProductionOrders ?? []).map((line) => ({
        ...line,
        sourceType: "Production Order" as SourceType,
        quantity: line.quantity ?? 0
      })),
      ...(forecastFetcher.data?.demandForecast ?? []).map((forecast) => {
        const period = periods.find((p) => p.id === forecast.periodId);
        const sources = (
          (forecastFetcher.data?.demandForecastSources ??
            []) as DemandForecastSourceRow[]
        ).filter(
          (s) =>
            s.itemId === forecast.itemId &&
            s.periodId === forecast.periodId &&
            (s.locationId ?? null) === (forecast.locationId ?? null)
        );
        return {
          id: null,
          sourceType: "Demand Forecast" as SourceType,
          quantity: forecast.forecastQuantity ?? 0,
          dueDate: period?.startDate ?? null,
          documentReadableId: "Demand Forecast",
          documentId: null,
          forecastMethod: forecast.forecastMethod ?? null,
          forecastSources: sources
        };
      })
    ];

    // Filter out planned orders that have matching existing IDs in forecast data
    const filteredPlannedOrders = plannedOrders.filter((order) => {
      if (!order.existingId) return true;
      return !forecastData.some((item) => item.id === order.existingId);
    });

    // For planned orders with existing IDs, update the quantity in forecast data
    plannedOrders.forEach((order) => {
      if (order.existingId) {
        const existingIndex = forecastData.findIndex(
          (item) => item.id === order.existingId
        );
        if (existingIndex >= 0) {
          // Convert purchase quantity to inventory quantity
          const purchaseQuantity = order.quantity ?? 0;
          const inventoryQuantity = purchaseQuantity * conversionFactor;
          forecastData[existingIndex].quantity = inventoryQuantity;
        }
      }
    });

    // Add remaining planned orders
    const combined = [
      ...forecastData,
      ...filteredPlannedOrders.map((order) => ({
        ...order,
        sourceType: "Planned" as SourceType,
        quantity: (order.quantity ?? 0) * conversionFactor,
        documentReadableId: "Planned",
        documentId: null,
        id: null,
        plannedOrder: order
      }))
    ]
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .map((item) => {
        if (
          item.sourceType === "Sales Order" ||
          item.sourceType === "Job Material" ||
          item.sourceType === "Demand Forecast"
        ) {
          projectedQuantity -= item.quantity;
        } else {
          projectedQuantity += item.quantity;
        }
        return {
          ...item,
          projectedQuantity
        };
      });

    if (!searchTerm) return combined;

    return combined.filter((item) =>
      (item.documentReadableId ?? "")
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );
  }, [forecastFetcher.data, searchTerm, plannedOrders, conversionFactor]);

  // Drives the legend + tooltip labels. Colors come from `chartColors` so there
  // is exactly one source of truth — the legend can never drift from the bars.
  const chartConfig: ChartConfig = {
    supply: { label: t`Supply`, color: chartColors.supply },
    planned: { label: t`Planned`, color: chartColors.planned },
    demand: { label: t`Demand`, color: chartColors.demand },
    demandForecast: {
      label: t`Demand Forecast`,
      color: chartColors.demandForecast
    },
    projection: { label: t`Projected on hand`, color: chartColors.projection },
    safety: { label: t`Safety stock`, color: chartColors.safety }
  };

  // Always render all 6 labels below the chart. The safety-stock line/band only
  // draws when a value is set, but the legend entry stays for a consistent key.
  const legendPayload = [
    {
      value: "projection",
      dataKey: "projection",
      type: "line" as const,
      color: chartColors.projection
    },
    {
      value: "safety",
      dataKey: "safety",
      type: "line" as const,
      color: chartColors.safety
    },
    {
      value: "supply",
      dataKey: "supply",
      type: "rect",
      color: chartColors.supply
    },
    {
      value: "planned",
      dataKey: "planned",
      type: "rect",
      color: chartColors.planned
    },
    {
      value: "demand",
      dataKey: "demand",
      type: "rect",
      color: chartColors.demand
    },
    {
      value: "demandForecast",
      dataKey: "demandForecast",
      type: "rect",
      color: chartColors.demandForecast
    }
  ];

  if (
    (forecastFetcher.data?.periods?.length ?? 0) === 0 ||
    (forecastFetcher.data?.demand.length === 0 &&
      forecastFetcher.data?.supply.length === 0 &&
      (forecastFetcher.data?.demandForecast?.length ?? 0) === 0)
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Projections</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-h-[360px] flex items-center justify-center">
          <Empty>
            <Trans>No planning data</Trans>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={cn(compact && "border-none p-0 dark:shadow-none")}>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>
              <Trans>Projected inventory</Trans>
            </CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t`How to read this chart`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <LuInfo className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="w-80 p-3">
                <ChartHelpContent />
              </TooltipContent>
            </Tooltip>
          </div>
          {/* <CardDescription>
            <Trans>
              The line is projected on-hand over the next 48 weeks. Bars show each
              week's supply (up) and demand (down).
            </Trans>
          </CardDescription> */}
        </CardHeader>
        <CardContent>
          <PlanningStatusBanner
            stockoutDate={chartData.stockoutDate}
            belowSafetyDate={chartData.belowSafetyDate}
            hasSafetyStock={hasSafetyStock}
          />
          <div className="w-full h-[360px]">
            <Loading isLoading={isFetching}>
              <ChartContainer config={chartConfig} className="w-full h-full">
                <ComposedChart data={chartData.data} stackOffset="sign">
                  <defs>
                    <linearGradient
                      id="projectionFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={chartColors.projection}
                        stopOpacity={0.18}
                      />
                      <stop
                        offset="100%"
                        stopColor={chartColors.projection}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="startDate"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                    interval="preserveStartEnd"
                    tickFormatter={(value) =>
                      dateFormatter.format(
                        parseDate(value).toDate(getLocalTimeZone())
                      )
                    }
                  />
                  {/* Hidden point-scale axis: bars + dates stay on the band scale
                      (aligned with each other); the projection line + stockout dot
                      ride this so they run edge-to-edge (full width). */}
                  <XAxis
                    xAxisId="full"
                    dataKey="startDate"
                    type="category"
                    scale="point"
                    padding={{ left: 0, right: 0 }}
                    hide
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    domain={[chartData.domainMin, chartData.domainMax]}
                    ticks={chartData.ticks}
                    allowDecimals={false}
                    label={{
                      value: t`Qty`,
                      angle: -90,
                      position: "insideLeft",
                      style: {
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 11
                      }
                    }}
                  />
                  {/* Danger bands: red below zero (stockout), amber between zero
                      and safety stock (buffer). Background tint, behind series. */}
                  {chartData.domainMin < 0 && (
                    <ReferenceArea
                      y1={chartData.domainMin}
                      y2={0}
                      fill={chartColors.demand}
                      fillOpacity={0.06}
                      ifOverflow="hidden"
                    />
                  )}
                  {hasSafetyStock && (
                    <ReferenceArea
                      y1={0}
                      y2={safetyStockValue}
                      fill={chartColors.safety}
                      fillOpacity={0.06}
                      ifOverflow="hidden"
                    />
                  )}
                  {demandSourceTypes.map((sourceType) => (
                    <Bar
                      key={sourceType}
                      dataKey={sourceType}
                      stackId="stack"
                      fill={chartColors.demand}
                      fillOpacity={0.5}
                    />
                  ))}
                  <Bar
                    dataKey="Demand Forecast"
                    stackId="stack"
                    fill={chartColors.demandForecast}
                    fillOpacity={0.5}
                  />
                  {supplySourceTypes.map((sourceType) => (
                    <Bar
                      key={sourceType}
                      dataKey={sourceType}
                      stackId="stack"
                      fill={chartColors.supply}
                      fillOpacity={0.5}
                    />
                  ))}
                  <Bar
                    dataKey="Planned"
                    stackId="stack"
                    fill={chartColors.planned}
                    fillOpacity={0.5}
                  />
                  {/* Hero: projected on-hand line. Rendered after the bars so it
                      sits on top; faint gradient instead of a flooded fill. */}
                  <Area
                    type="monotone"
                    dataKey="Projection"
                    xAxisId="full"
                    strokeWidth={2.5}
                    dot={false}
                    stroke={chartColors.projection}
                    fill="url(#projectionFill)"
                    isAnimationActive={false}
                  />
                  <ReferenceLine
                    y={0}
                    stroke={chartColors.zero}
                    strokeDasharray="3 3"
                  />
                  {hasSafetyStock && (
                    <ReferenceLine
                      y={safetyStockValue}
                      stroke={chartColors.safety}
                      strokeDasharray="4 4"
                      label={{
                        // Label + value together, inside the plot, so the number
                        // never collides with the Y-axis tick numbers.
                        value: t`Safety stock (${numberFormatter.format(safetyStockValue)})`,
                        position: "insideTopLeft",
                        fill: chartColors.safety,
                        fontSize: 11,
                        fontWeight: 600
                      }}
                    />
                  )}
                  {chartData.stockoutDate && (
                    <ReferenceDot
                      x={chartData.stockoutDate}
                      y={0}
                      xAxisId="full"
                      r={5}
                      fill={chartColors.demand}
                      stroke="hsl(var(--background))"
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                      label={{
                        value: t`Stockout`,
                        position: "top",
                        fill: chartColors.demand,
                        fontSize: 11
                      }}
                    />
                  )}
                  <ChartTooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    content={
                      <PlanningChartTooltip
                        safetyStock={
                          hasSafetyStock ? safetyStockValue : undefined
                        }
                      />
                    }
                  />
                  <ChartLegend
                    content={<PlanningChartLegend config={chartConfig} />}
                    payload={legendPayload as never}
                  />
                </ComposedChart>
              </ChartContainer>
            </Loading>
          </div>
        </CardContent>
      </Card>
      <Tabs defaultValue="all" className="w-full">
        <Card className={cn(compact && "border-none p-0 dark:shadow-none")}>
          <HStack className="w-full justify-between">
            <CardHeader>
              <CardTitle>
                <Trans>Supply & Demand</Trans>
              </CardTitle>
            </CardHeader>
            <CardAction className="flex items-center gap-2">
              <TabsList>
                <TabsTrigger value="all">
                  <Trans>All</Trans>
                </TabsTrigger>
                <TabsTrigger value="supply">
                  <Trans>Supply</Trans>
                </TabsTrigger>
                <TabsTrigger value="demand">
                  <Trans>Demand</Trans>
                </TabsTrigger>
              </TabsList>
            </CardAction>
          </HStack>
          <CardContent>
            <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-4 py-4">
              <Card>
                <CardHeader className="pb-8">
                  <CardDescription>
                    <VStack>
                      <Trans>Quantity on Hand</Trans>
                    </VStack>
                  </CardDescription>
                  <CardTitle className="text-4xl ">
                    <div className="flex justify-start items-center gap-1">
                      {`${numberFormatter.format(
                        forecastFetcher.data?.quantityOnHand ?? 0
                      )}`}
                    </div>
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-8">
                  <CardDescription>
                    <VStack>
                      <Trans>Incoming</Trans>
                    </VStack>
                  </CardDescription>
                  <CardTitle className="text-4xl ">
                    <div className="flex justify-start items-center gap-1">
                      {`${numberFormatter.format(
                        forecastFetcher.data?.supply.reduce(
                          (acc, curr) => acc + (curr.actualQuantity ?? 0),
                          0
                        ) ?? 0
                      )}`}
                      <LuMoveUp
                        className="text-lg"
                        style={{ color: chartColors.supply }}
                      />
                    </div>
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-8">
                  <CardDescription>
                    <VStack>
                      <Trans>Outgoing</Trans>
                    </VStack>
                  </CardDescription>
                  <CardTitle className="text-4xl ">
                    <div className="flex justify-start items-center gap-1">
                      {`${numberFormatter.format(
                        (forecastFetcher.data?.demand.reduce(
                          (acc, curr) => acc + (curr.actualQuantity ?? 0),
                          0
                        ) ?? 0) +
                          (forecastFetcher.data?.demandForecast?.reduce(
                            (acc, curr) => acc + (curr.forecastQuantity ?? 0),
                            0
                          ) ?? 0)
                      )}`}
                      <LuMoveDown
                        className="text-lg"
                        style={{ color: chartColors.demand }}
                      />
                    </div>
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="relative w-full mb-4">
              <Input
                placeholder={t`Search`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              <LuSearch className="absolute left-3 top-3 size-4 text-muted-foreground" />
            </div>

            <TabsContent value="all" className="border rounded-lg">
              <SupplyDemandPlanningHeader />
              {combinedSupplyAndDemand.map((item, index) => (
                <SupplyDemandPlanningItem
                  key={index}
                  item={item}
                  conversionFactor={conversionFactor}
                />
              ))}
            </TabsContent>

            <TabsContent value="supply" className="border rounded-lg">
              <SupplyDemandPlanningHeader />
              {combinedSupplyAndDemand
                .filter((item) =>
                  supplySourceTypes.includes(
                    item.sourceType as (typeof supplySourceTypes)[number]
                  )
                )
                .map((item, index) => (
                  <SupplyDemandPlanningItem
                    key={index}
                    item={item}
                    conversionFactor={conversionFactor}
                  />
                ))}
            </TabsContent>

            <TabsContent value="demand" className="border rounded-lg">
              <SupplyDemandPlanningHeader />
              {combinedSupplyAndDemand
                .filter(
                  (item) =>
                    demandSourceTypes.includes(
                      item.sourceType as (typeof demandSourceTypes)[number]
                    ) || item.sourceType === "Demand Forecast"
                )
                .map((item, index) => (
                  <SupplyDemandPlanningItem
                    key={index}
                    item={item}
                    conversionFactor={conversionFactor}
                  />
                ))}
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </>
  );
};

// Legend that distinguishes line series (Projected on hand, Safety stock) from
// bar series with a line vs. square glyph, so "the line" maps to something.
function PlanningChartLegend({
  payload,
  config
}: {
  payload?: Array<{ dataKey: string; type?: string; color?: string }>;
  config: ChartConfig;
}) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3 text-xs text-muted-foreground">
      {payload.map((item) => (
        <div key={item.dataKey} className="flex items-center gap-1.5">
          {item.type === "line" ? (
            <span
              className="h-[3px] w-3.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
          ) : (
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
          )}
          <span>{config[item.dataKey]?.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChartHelpContent() {
  const { t } = useLingui();

  const rows: {
    color: string;
    label: string;
    description: string;
    line?: boolean;
  }[] = [
    {
      color: chartColors.projection,
      label: t`Projected on hand`,
      description: t`Running inventory after each week's supply and demand — the line.`,
      line: true
    },
    {
      color: chartColors.safety,
      label: t`Safety stock`,
      description: t`The dashed threshold you don't want inventory to fall below.`,
      line: true
    },
    {
      color: chartColors.supply,
      label: t`Supply`,
      description: t`Confirmed incoming stock — purchase & production orders (bars above zero).`
    },
    {
      color: chartColors.planned,
      label: t`Planned`,
      description: t`Suggested orders you haven't placed yet.`
    },
    {
      color: chartColors.demand,
      label: t`Demand`,
      description: t`Confirmed outgoing stock — sales orders & job materials (bars below zero).`
    },
    {
      color: chartColors.demandForecast,
      label: t`Demand Forecast`,
      description: t`Projected demand exploded from BOMs and forecasts.`
    }
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-muted-foreground">
        <Trans>
          Bars show each week's flow:{" "}
          <span className="font-medium" style={{ color: chartColors.supply }}>
            supply
          </span>{" "}
          pushes inventory up,{" "}
          <span className="font-medium" style={{ color: chartColors.demand }}>
            demand
          </span>{" "}
          pulls it down. The{" "}
          <span
            className="font-medium"
            style={{ color: chartColors.projection }}
          >
            line
          </span>{" "}
          is your projected on-hand inventory — when it dips below{" "}
          <span className="font-medium" style={{ color: chartColors.safety }}>
            safety stock
          </span>{" "}
          you're at risk, and below zero is a{" "}
          <span className="font-medium" style={{ color: chartColors.demand }}>
            stockout
          </span>
          .
        </Trans>
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-2">
            {row.line ? (
              // line series → a short horizontal line glyph
              <span
                className="mt-[7px] h-[3px] w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
            ) : (
              // bar series → a square swatch
              <span
                className="mt-[3px] size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: row.color }}
              />
            )}
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-medium text-foreground">
                {row.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.description}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanningStatusBanner({
  stockoutDate,
  belowSafetyDate,
  hasSafetyStock
}: {
  stockoutDate: string | null;
  belowSafetyDate: string | null;
  hasSafetyStock: boolean;
}) {
  const { t } = useLingui();
  const dateFormatter = useDateFormatter({ month: "short", day: "numeric" });

  const formatWeek = (date: string) =>
    dateFormatter.format(parseDate(date).toDate(getLocalTimeZone()));

  let tone: "danger" | "warning" | "success";
  let icon: JSX.Element;
  let message: string;

  if (stockoutDate) {
    tone = "danger";
    icon = <LuTriangleAlert className="size-4 shrink-0" />;
    message = t`Projected stockout the week of ${formatWeek(stockoutDate)}`;
  } else if (belowSafetyDate) {
    tone = "warning";
    icon = <LuTriangleAlert className="size-4 shrink-0" />;
    message = t`Projected to drop below safety stock the week of ${formatWeek(belowSafetyDate)}`;
  } else {
    tone = "success";
    icon = <LuCircleCheck className="size-4 shrink-0" />;
    message = hasSafetyStock
      ? t`Projected to stay above safety stock`
      : t`No stockout projected in the next 48 weeks`;
  }

  const color =
    tone === "danger"
      ? chartColors.demand
      : tone === "warning"
        ? chartColors.safety
        : chartColors.supply;
  const backgroundColor =
    tone === "danger"
      ? "hsl(var(--destructive) / 0.08)"
      : tone === "warning"
        ? "hsl(var(--chart-6) / 0.12)"
        : "hsl(var(--success) / 0.08)";

  return (
    <div
      className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
      style={{ color, backgroundColor }}
    >
      {icon}
      <span className="text-pretty">{message}</span>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  value,
  valueStyle,
  bold
}: {
  color: string;
  label: string;
  value: string;
  valueStyle?: CSSProperties;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className="size-2 shrink-0 rounded-[2px]"
          style={{ backgroundColor: color }}
        />
        <span>{label}</span>
      </div>
      <span
        className={cn("tabular-nums", bold && "font-medium text-foreground")}
        style={valueStyle}
      >
        {value}
      </span>
    </div>
  );
}

function PlanningChartTooltip({
  active,
  payload,
  safetyStock
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDataPoint }>;
  safetyStock?: number;
}) {
  const { t } = useLingui();
  const dateFormatter = useDateFormatter({ month: "short", day: "numeric" });
  const numberFormatter = useNumberFormatter();

  if (!active || !payload?.length) return null;

  const d = payload[0].payload;
  // Mirror the four series the chart draws — keep Demand Forecast distinct from
  // actual Demand, and Planned distinct from confirmed Supply.
  const supply = d["Purchase Order"] + d["Production Order"];
  const planned = d.Planned;
  // Demand keys are stored negative; flip to a positive magnitude for display.
  const demand = -(d["Sales Order"] + d["Job Material"]);
  const demandForecast = -d["Demand Forecast"];
  const projection = d.Projection;
  const isStockout = projection < 0;
  const isBelowSafety =
    !isStockout && typeof safetyStock === "number" && projection < safetyStock;
  const projectionColor = isStockout
    ? chartColors.demand
    : isBelowSafety
      ? chartColors.safety
      : chartColors.projection;

  return (
    <div className="min-w-[13rem] rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium mb-2">
        {t`Week of ${dateFormatter.format(parseDate(d.startDate).toDate(getLocalTimeZone()))}`}
      </div>
      <div className="grid gap-1.5">
        <TooltipRow
          color={chartColors.projection}
          label={t`Projected on hand`}
          value={numberFormatter.format(projection)}
          valueStyle={{ color: projectionColor }}
          bold
        />
        {supply !== 0 && (
          <TooltipRow
            color={chartColors.supply}
            label={t`Supply`}
            value={`+${numberFormatter.format(supply)}`}
          />
        )}
        {planned !== 0 && (
          <TooltipRow
            color={chartColors.planned}
            label={t`Planned`}
            value={`+${numberFormatter.format(planned)}`}
          />
        )}
        {demand !== 0 && (
          <TooltipRow
            color={chartColors.demand}
            label={t`Demand`}
            value={`−${numberFormatter.format(demand)}`}
          />
        )}
        {demandForecast !== 0 && (
          <TooltipRow
            color={chartColors.demandForecast}
            label={t`Demand Forecast`}
            value={`−${numberFormatter.format(demandForecast)}`}
          />
        )}
      </div>
      {(isStockout || isBelowSafety) && (
        <div
          className="mt-2 flex items-center gap-1.5 font-medium"
          style={{
            color: isStockout ? chartColors.demand : chartColors.safety
          }}
        >
          <LuTriangleAlert className="size-3.5" />
          {isStockout ? t`Stockout` : t`Below safety stock`}
        </div>
      )}
    </div>
  );
}

interface PlanningItem {
  sourceType: SourceType;
  id: string | null;
  dueDate: string | null;
  documentReadableId: string | null;
  documentId: string | null;
  quantity: number;
  projectedQuantity: number;
  parentMaterialId?: string | null;
  jobId?: string | null;
  jobMakeMethodId?: string | null;
  existingOrderReadableId?: string | null;
  forecastMethod?: string | null;
  forecastSources?: DemandForecastSourceRow[];
  // Planned-row metadata (only set on rows with sourceType === "Planned").
  // Carries enough info for PlannedOrderDetailsPopover to render order facts,
  // policy reasoning, and the linked PO section.
  plannedOrder?: PlannedOrder;
}

const sourceTypeIcons: Record<SourceType, JSX.Element> = {
  "Sales Order": (
    <LuCrown className="size-4" style={{ color: chartColors.demand }} />
  ),
  "Job Material": (
    <LuClipboardList className="size-4" style={{ color: chartColors.demand }} />
  ),
  "Purchase Order": (
    <LuShoppingCart className="size-4" style={{ color: chartColors.supply }} />
  ),
  "Production Order": (
    <LuFactory className="size-4" style={{ color: chartColors.supply }} />
  ),
  Planned: (
    <LuMoveUp className="size-4" style={{ color: chartColors.planned }} />
  ),
  "Demand Forecast": (
    <LuChartLine
      className="size-4"
      style={{ color: chartColors.demandForecast }}
    />
  )
};

function SupplyDemandPlanningHeader() {
  return (
    <div className="flex flex-1 justify-between items-center w-full px-4 py-2 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <HStack spacing={4} className="w-1/2">
        <HStack spacing={4} className="flex-1">
          <div className="size-8 shrink-0" aria-hidden />
          <VStack spacing={0} className="flex-1">
            <Trans>Source</Trans>
          </VStack>
          <div className="text-right">
            <Trans>Quantity</Trans>
          </div>
        </HStack>
      </HStack>
      <Trans>On Hand</Trans>
    </div>
  );
}

function SupplyDemandPlanningItem({
  item,
  conversionFactor
}: {
  item: PlanningItem;
  conversionFactor: number;
}) {
  const { t } = useLingui();
  const numberFormatter = useNumberFormatter();
  const { formatDate } = useDateFormat();

  return (
    <div className="flex flex-1 justify-between items-center w-full p-4 border-b last:border-b-0">
      <HStack spacing={4} className="w-1/2">
        <HStack spacing={4} className="flex-1">
          <div className="bg-muted border rounded-full flex items-center justify-center p-2">
            {sourceTypeIcons[item.sourceType]}
          </div>
          <VStack spacing={0}>
            {item.sourceType === "Demand Forecast" ? (
              <DemandForecastSourcesPopover
                sources={item.forecastSources ?? []}
                forecastQuantity={item.quantity}
                forecastMethod={item.forecastMethod ?? null}
              >
                <button
                  type="button"
                  className="text-sm font-medium text-left hover:underline"
                >
                  {item.documentReadableId}
                </button>
              </DemandForecastSourcesPopover>
            ) : item.sourceType === "Planned" && item.plannedOrder ? (
              <PlannedOrderDetailsPopover
                order={item.plannedOrder}
                conversionFactor={conversionFactor}
              >
                <button
                  type="button"
                  className="text-sm font-medium text-left hover:underline"
                >
                  {item.documentReadableId}
                </button>
              </PlannedOrderDetailsPopover>
            ) : (
              <Hyperlink
                to={getPathToDocument(item)}
                className="text-sm font-medium"
              >
                {item.documentReadableId}
              </Hyperlink>
            )}
            <span className="text-xs text-muted-foreground">
              {item.dueDate ? formatDate(item.dueDate) : t`No due date`}
            </span>
          </VStack>
          <div className="flex items-center gap-1 text-sm text-muted-foreground text-right">
            <span>{numberFormatter.format(item.quantity)}</span>
            {item.sourceType === "Sales Order" ||
            item.sourceType === "Job Material" ||
            item.sourceType === "Demand Forecast" ? (
              <LuMoveDown style={{ color: chartColors.demand }} />
            ) : (
              <LuMoveUp style={{ color: chartColors.supply }} />
            )}
          </div>
        </HStack>
      </HStack>

      <span
        className="text-sm tabular-nums"
        style={
          item.projectedQuantity < 0 ? { color: chartColors.demand } : undefined
        }
      >
        {numberFormatter.format(item.projectedQuantity)}
      </span>
    </div>
  );
}

function getPathToDocument(item: PlanningItem) {
  switch (item.sourceType) {
    case "Sales Order":
      return path.to.salesOrder(item.documentId ?? "");
    case "Job Material":
      if (!item.jobId) return "#";
      if (!item.jobMakeMethodId) return "#";
      return item.parentMaterialId
        ? path.to.jobMakeMethod(item.jobId, item.jobMakeMethodId)
        : path.to.jobMethod(item.jobId, item.jobMakeMethodId);
    case "Purchase Order":
      return path.to.purchaseOrder(item.documentId ?? "");
    case "Production Order":
      return path.to.job(item.documentId ?? "");
    case "Planned":
      return "#";
    case "Demand Forecast":
      return "#";
    default:
      return "";
  }
}
