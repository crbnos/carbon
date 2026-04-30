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
  useMount,
  VStack
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";

import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import {
  LuChartLine,
  LuClipboardList,
  LuCrown,
  LuFactory,
  LuMoveDown,
  LuMoveUp,
  LuSearch,
  LuShoppingCart
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  XAxis,
  YAxis
} from "recharts";
import { Empty, Hyperlink } from "~/components";
import { useDateFormatter as useDateFormat } from "~/hooks";
import type { loader as forecastLoader } from "~/routes/api+/items.$id.$locationId.forecast";
import { path } from "~/utils/path";
import type { PlannedOrder } from "../../../purchasing/purchasing.models";

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

const chartConfig = {} satisfies ChartConfig;

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

  const chartData = useMemo(() => {
    if (
      !forecastFetcher.data?.demand ||
      !forecastFetcher.data?.periods ||
      forecastFetcher.data.periods.length === 0
    )
      return [];

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

      // If no period found or order date is before first period, use first period
      if (!periodId || !order.dueDate) {
        if (periods.length === 0) return;
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

    return sortedData.map((period) => {
      // Add supply
      runningProjection +=
        period["Purchase Order"] +
        period["Production Order"] +
        // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
        period["Planned"];
      // Subtract demand (all values are already negative)
      runningProjection +=
        period["Sales Order"] +
        period["Job Material"] +
        period["Demand Forecast"];
      // Update projection
      period.Projection = runningProjection;
      return period;
    });
  }, [forecastFetcher.data, plannedOrders, conversionFactor]);

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
        return {
          id: null,
          sourceType: "Demand Forecast" as SourceType,
          quantity: forecast.forecastQuantity ?? 0,
          dueDate: period?.startDate ?? null,
          documentReadableId: "Demand Forecast",
          documentId: null
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
        id: null
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
          <CardTitle>
            <Trans>Projections</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full h-[360px]">
            <Loading isLoading={isFetching}>
              <ChartContainer config={chartConfig} className="w-full h-full">
                <ComposedChart data={chartData} stackOffset="sign">
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="startDate"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      dateFormatter.format(
                        parseDate(value).toDate(getLocalTimeZone())
                      )
                    }
                  />
                  <YAxis tickLine={false} axisLine={false} />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                  {safetyStock && safetyStock > 0 && (
                    <ReferenceLine
                      y={safetyStock}
                      stroke="#f43f5e"
                      strokeDasharray="3 3"
                    />
                  )}
                  <Legend
                    payload={[
                      { value: "Demand", type: "rect", color: "#14b8a6" },
                      {
                        value: "Demand Forecast",
                        type: "rect",
                        color: "#06b6d4"
                      },
                      { value: "Supply", type: "rect", color: "#2563eb" },
                      { value: "Planned", type: "rect", color: "#4f46e5" },
                      {
                        value: "Projection",
                        type: "line",
                        color: "#7c3aed"
                      },
                      ...(safetyStock && safetyStock > 0
                        ? [
                            {
                              value: "Safety Stock",
                              type: "line" as const,
                              color: "#f43f5e"
                            }
                          ]
                        : [])
                    ]}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) =>
                          `Week of ${dateFormatter.format(
                            parseDate(value).toDate(getLocalTimeZone())
                          )}`
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="Projection"
                    strokeWidth={1}
                    dot={false}
                    stroke="#7c3aed"
                    fill="#7c3aedcc"
                    isAnimationActive={false}
                  />
                  {demandSourceTypes.map((sourceType) => (
                    <Bar
                      key={sourceType}
                      dataKey={sourceType}
                      stackId="stack"
                      className="fill-teal-500"
                    />
                  ))}
                  <Bar
                    dataKey="Demand Forecast"
                    stackId="stack"
                    className="fill-cyan-500"
                  />
                  {supplySourceTypes.map((sourceType) => (
                    <Bar
                      key={sourceType}
                      dataKey={sourceType}
                      stackId="stack"
                      className="fill-blue-600"
                    />
                  ))}
                  <Bar
                    dataKey="Planned"
                    stackId="stack"
                    className="fill-indigo-600"
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
                      <LuMoveUp className="text-teal-500 text-lg" />
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
                      <LuMoveDown className="text-red-500 text-lg" />
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
              {combinedSupplyAndDemand.map((item, index) => (
                <SupplyDemandPlanningItem key={index} item={item} />
              ))}
            </TabsContent>

            <TabsContent value="supply" className="border rounded-lg">
              {combinedSupplyAndDemand
                .filter((item) =>
                  supplySourceTypes.includes(
                    item.sourceType as (typeof supplySourceTypes)[number]
                  )
                )
                .map((item, index) => (
                  <SupplyDemandPlanningItem key={index} item={item} />
                ))}
            </TabsContent>

            <TabsContent value="demand" className="border rounded-lg">
              {combinedSupplyAndDemand
                .filter(
                  (item) =>
                    demandSourceTypes.includes(
                      item.sourceType as (typeof demandSourceTypes)[number]
                    ) || item.sourceType === "Demand Forecast"
                )
                .map((item, index) => (
                  <SupplyDemandPlanningItem key={index} item={item} />
                ))}
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </>
  );
};

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
}

const sourceTypeIcons: Record<SourceType, JSX.Element> = {
  "Sales Order": <LuCrown className="size-4 text-teal-500" />,
  "Job Material": <LuClipboardList className="size-4 text-teal-500" />,
  "Purchase Order": <LuShoppingCart className="size-4 text-blue-600" />,
  "Production Order": <LuFactory className="size-4 text-blue-600" />,
  Planned: <LuMoveUp className="size-4 text-indigo-600" />,
  "Demand Forecast": <LuChartLine className="size-4 text-cyan-500" />
};

function SupplyDemandPlanningItem({ item }: { item: PlanningItem }) {
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
            <Hyperlink
              to={getPathToDocument(item)}
              className="text-sm font-medium"
            >
              {item.documentReadableId}
            </Hyperlink>
            <span className="text-xs text-muted-foreground">
              {item.dueDate ? formatDate(item.dueDate) : t`No due date`}
            </span>
          </VStack>
          <div className="flex items-center gap-1 text-sm text-muted-foreground text-right">
            <span>{numberFormatter.format(item.quantity)}</span>
            {item.sourceType === "Sales Order" ||
            item.sourceType === "Job Material" ||
            item.sourceType === "Demand Forecast" ? (
              <LuMoveDown className="text-red-500" />
            ) : (
              <LuMoveUp className="text-teal-500" />
            )}
          </div>
        </HStack>
      </HStack>

      <span
        className={cn("text-sm", item.projectedQuantity < 0 && "text-red-500")}
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
