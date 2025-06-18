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
  VStack,
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@carbon/react/Chart";
import { formatDate } from "@carbon/utils";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import { useFetcher } from "@remix-run/react";

import { useMemo, useState } from "react";
import {
  LuClipboardList,
  LuCrown,
  LuFactory,
  LuMoveDown,
  LuMoveUp,
  LuSearch,
  LuShoppingCart,
} from "react-icons/lu";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Empty, Hyperlink } from "~/components";
import type { loader as forecastLoader } from "~/routes/api+/items.$id.$locationId.forecast";
import { path } from "~/utils/path";

const supplySourceTypes = ["Purchase Order", "Production Order"] as const;
const demandSourceTypes = ["Sales Order", "Job Material"] as const;

interface ChartDataPoint {
  startDate: string;
  period: string;
  "Sales Order": number;
  "Job Material": number;
  "Purchase Order": number;
  "Production Order": number;
  Projection: number;
}

const chartConfig = {} satisfies ChartConfig;

export const ItemPlanningChart = ({
  itemId,
  locationId,
  safetyStock,
}: {
  itemId: string;
  locationId: string;
  safetyStock?: number;
}) => {
  const forecastFetcher = useFetcher<typeof forecastLoader>();
  const isFetching = forecastFetcher.state !== "idle" || !forecastFetcher.data;
  const [searchTerm, setSearchTerm] = useState("");

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric",
  });

  const numberFormatter = useNumberFormatter();

  useMount(() => {
    forecastFetcher.load(path.to.api.itemForecast(itemId, locationId));
  });

  const chartData = useMemo(() => {
    if (!forecastFetcher.data?.demand || !forecastFetcher.data?.periods)
      return [];

    const periods = forecastFetcher.data.periods;
    const demand = forecastFetcher.data.demand;
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
          Projection: currentQuantity, // Initialize with current quantity
        };
        return acc;
      },
      {}
    );

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

    // Calculate running projection
    let runningProjection = currentQuantity;
    const sortedData = Object.values(groupedData).sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    return sortedData.map((period) => {
      // Add supply
      runningProjection +=
        period["Purchase Order"] + period["Production Order"];
      // Subtract demand
      runningProjection += period["Sales Order"] + period["Job Material"];
      // Update projection
      period.Projection = runningProjection;
      return period;
    });
  }, [forecastFetcher.data]);

  const combinedSupplyAndDemand = useMemo(() => {
    let projectedQuantity = forecastFetcher.data?.quantityOnHand ?? 0;

    const combined = [
      ...(forecastFetcher.data?.openSalesOrderLines ?? []).map((line) => ({
        ...line,
        sourceType: "Sales Order",
        quantity: line.quantity ?? 0,
      })),
      ...(forecastFetcher.data?.openJobMaterials ?? []).map((line) => ({
        ...line,
        sourceType: "Job Material",
        quantity: line.quantity ?? 0,
      })),
      ...(forecastFetcher.data?.openPurchaseOrderLines ?? []).map((line) => ({
        ...line,
        sourceType: "Purchase Order",
        quantity: line.quantity ?? 0,
      })),
      ...(forecastFetcher.data?.openProductionOrders ?? []).map((line) => ({
        ...line,
        sourceType: "Production Order",
        quantity: line.quantity ?? 0,
      })),
    ]
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .map((item) => {
        if (
          item.sourceType === "Sales Order" ||
          item.sourceType === "Job Material"
        ) {
          projectedQuantity -= item.quantity;
        } else {
          projectedQuantity += item.quantity;
        }
        return {
          ...item,
          projectedQuantity,
        };
      });

    if (!searchTerm) return combined;

    return combined.filter((item) =>
      (item.documentReadableId ?? "")
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );
  }, [forecastFetcher.data, searchTerm]);

  if (
    forecastFetcher.data?.demand.length === 0 &&
    forecastFetcher.data?.supply.length === 0
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Projections</CardTitle>
        </CardHeader>
        <CardContent className="min-h-[360px] flex items-center justify-center">
          <Empty>No planning data</Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Projections</CardTitle>
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
                      { value: "Supply", type: "rect", color: "#2563eb" },
                      {
                        value: "Projection",
                        type: "line",
                        color: "#7c3aed",
                      },
                      ...(safetyStock && safetyStock > 0
                        ? [
                            {
                              value: "Safety Stock",
                              type: "line" as const,
                              color: "#f43f5e",
                            },
                          ]
                        : []),
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
                  {demandSourceTypes.map(
                    (sourceType: string, index: number) => (
                      <Bar
                        key={sourceType}
                        dataKey={sourceType}
                        stackId="stack"
                        className="fill-teal-500"
                      />
                    )
                  )}
                  {supplySourceTypes.map(
                    (sourceType: string, index: number) => (
                      <Bar
                        key={sourceType}
                        dataKey={sourceType}
                        stackId="stack"
                        className="fill-blue-600"
                      />
                    )
                  )}
                </ComposedChart>
              </ChartContainer>
            </Loading>
          </div>
        </CardContent>
      </Card>
      <Tabs defaultValue="all" className="w-full">
        <Card>
          <HStack className="w-full justify-between">
            <CardHeader>
              <CardTitle>Supply & Demand</CardTitle>
            </CardHeader>
            <CardAction className="flex items-center gap-2">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="supply">Supply</TabsTrigger>
                <TabsTrigger value="demand">Demand</TabsTrigger>
              </TabsList>
            </CardAction>
          </HStack>
          <CardContent>
            <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-4 py-4">
              <Card>
                <CardHeader className="pb-8">
                  <CardDescription>
                    <VStack>Quantity on Hand</VStack>
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
                    <VStack>Incoming</VStack>
                  </CardDescription>
                  <CardTitle className="text-4xl ">
                    <div className="flex justify-start items-center gap-1">
                      {`${numberFormatter.format(
                        forecastFetcher.data?.supply.reduce(
                          (acc, curr) => acc + (curr.actualQuantity ?? 0),
                          0
                        ) ?? 0
                      )}`}
                      <LuMoveUp className="text-emerald-500 text-lg" />
                    </div>
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-8">
                  <CardDescription>
                    <VStack>Outgoing</VStack>
                  </CardDescription>
                  <CardTitle className="text-4xl ">
                    <div className="flex justify-start items-center gap-1">
                      {`${numberFormatter.format(
                        forecastFetcher.data?.demand.reduce(
                          (acc, curr) => acc + (curr.actualQuantity ?? 0),
                          0
                        ) ?? 0
                      )}`}
                      <LuMoveDown className="text-red-500 text-lg" />
                    </div>
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="relative w-full mb-4">
              <Input
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              <LuSearch className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
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
                .filter((item) =>
                  demandSourceTypes.includes(
                    item.sourceType as (typeof demandSourceTypes)[number]
                  )
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
  sourceType: string;
  id: string | null;
  dueDate: string | null;
  documentReadableId: string | null;
  documentId: string | null;
  quantity: number;
  projectedQuantity: number;
  parentMaterialId?: string | null;
  jobId?: string | null;
  jobMakeMethodId?: string | null;
}

const sourceTypeIcons = {
  "Sales Order": <LuCrown className="h-4 w-4 text-teal-500" />,
  "Job Material": <LuClipboardList className="h-4 w-4 text-teal-500" />,
  "Purchase Order": <LuShoppingCart className="h-4 w-4 text-blue-600" />,
  "Production Order": <LuFactory className="h-4 w-4 text-blue-600" />,
};

function SupplyDemandPlanningItem({ item }: { item: PlanningItem }) {
  const numberFormatter = useNumberFormatter();

  return (
    <div className="flex flex-1 justify-between items-center w-full p-4 border-b last:border-b-0">
      <HStack spacing={4} className="w-1/2">
        <HStack spacing={4} className="flex-1">
          <div className="bg-muted border rounded-full flex items-center justify-center p-2">
            {sourceTypeIcons[item.sourceType as keyof typeof sourceTypeIcons]}
          </div>
          <VStack spacing={0}>
            <Hyperlink
              to={getPathToDocument(item)}
              className="text-sm font-medium"
            >
              {item.documentReadableId}
            </Hyperlink>
            <span className="text-xs text-muted-foreground">
              {item.dueDate ? formatDate(item.dueDate) : "No due date"}
            </span>
          </VStack>
          <div className="flex items-center gap-1 text-sm text-muted-foreground text-right">
            <span>{numberFormatter.format(item.quantity)}</span>
            {item.sourceType === "Sales Order" ||
            item.sourceType === "Job Material" ? (
              <LuMoveDown className="text-red-500" />
            ) : (
              <LuMoveUp className="text-emerald-500" />
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
    default:
      return "";
  }
}
