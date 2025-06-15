import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Loading,
  useMount,
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@carbon/react/Chart";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useDateFormatter } from "@react-aria/i18n";
import { useFetcher } from "@remix-run/react";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Empty } from "~/components";
import type { loader as forecastLoader } from "~/routes/api+/items.$id.$locationId.forecast";
import { path } from "~/utils/path";

interface Data {
  actualQuantity: number;
  companyId: string;
  createdAt: string;
  createdBy: string;
  itemId: string;
  locationId: string;
  notes: string | null;
  periodId: string;
  updatedAt: string;
  updatedBy: string;
}
const supplySourceTypes = ["Purchase Order", "Production Order"] as const;
const demandSourceTypes = ["Sales Order", "Job Material"] as const;

interface DemandData extends Data {
  sourceType: (typeof demandSourceTypes)[number];
}

interface SupplyData extends Data {
  sourceType: (typeof supplySourceTypes)[number];
}

interface ChartDataPoint {
  startDate: string;
  period: string;
  "Sales Order": number;
  "Job Material": number;
  "Purchase Order": number;
  "Production Order": number;
  Projection: number;
}

export const ItemPlanningChart = ({
  itemId,
  locationId,
}: {
  itemId: string;
  locationId: string;
}) => {
  const forecastFetcher = useFetcher<typeof forecastLoader>();
  const isFetching = forecastFetcher.state !== "idle" || !forecastFetcher.data;

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric",
  });

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
    demand.forEach((curr: DemandData) => {
      if (groupedData[curr.periodId]) {
        groupedData[curr.periodId][curr.sourceType] -= curr.actualQuantity;
      }
    });

    // Add supply data
    supply.forEach((curr: SupplyData) => {
      if (groupedData[curr.periodId]) {
        groupedData[curr.periodId][curr.sourceType] += curr.actualQuantity;
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

  const chartConfig = {} satisfies ChartConfig;

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
                  <Legend
                    payload={[
                      { value: "Demand", type: "rect", color: "#14b8a6" },
                      { value: "Supply", type: "rect", color: "#2563eb" },
                      {
                        value: "Projection",
                        type: "line",
                        color: "#7c3aed",
                      },
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
                  <Line
                    type="monotone"
                    dataKey="Projection"
                    strokeWidth={2}
                    dot={false}
                    stroke="#7c3aed"
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            </Loading>
          </div>
        </CardContent>
      </Card>
    </>
  );
};
