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
import { Bar, BarChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";
import { Empty } from "~/components";
import type { loader as forecastLoader } from "~/routes/api+/items.$id.$locationId.forecast";
import { path } from "~/utils/path";

interface DemandData {
  actualQuantity: number;
  companyId: string;
  createdAt: string;
  createdBy: string;
  itemId: string;
  locationId: string;
  notes: string | null;
  periodId: string;
  sourceType: "Sales Order" | "Job Material";
  updatedAt: string;
  updatedBy: string;
}

interface ChartDataPoint {
  startDate: string;
  period: string;
  "Sales Order": number;
  "Job Material": number;
  forecast: number;
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
    const forecast = forecastFetcher.data?.forecast ?? 5;

    // Initialize all periods with zero values
    const groupedData = periods.reduce(
      (acc: Record<string, ChartDataPoint>, period) => {
        acc[period.id] = {
          period: period.id,
          startDate: period.startDate,
          "Sales Order": 0,
          "Job Material": 0,
          forecast,
        };
        return acc;
      },
      {}
    );

    // Add demand data
    demand.forEach((curr: DemandData) => {
      if (groupedData[curr.periodId]) {
        groupedData[curr.periodId][curr.sourceType] += curr.actualQuantity;
      }
    });

    return Object.values(groupedData).sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
  }, [
    forecastFetcher.data?.demand,
    forecastFetcher.data?.periods,
    forecastFetcher.data?.forecast,
  ]);

  const sourceTypes = useMemo(() => {
    if (!forecastFetcher.data?.demand) return [];
    return [
      ...new Set(
        forecastFetcher.data.demand.map((item: DemandData) => item.sourceType)
      ),
    ];
  }, [forecastFetcher.data?.demand]);

  const chartConfig = {} satisfies ChartConfig;

  if (forecastFetcher.data?.demand.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Demand</CardTitle>
        </CardHeader>
        <CardContent className="min-h-[360px] flex items-center justify-center">
          <Empty>No demand data</Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Demand</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="min-h-[200px] max-h-[360px]">
            <Loading isLoading={isFetching}>
              <ChartContainer config={chartConfig} className="w-full h-full">
                <BarChart data={chartData}>
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
                  {sourceTypes.map((sourceType: string, index: number) => (
                    <Bar
                      key={sourceType}
                      dataKey={sourceType}
                      stackId="demand"
                      className={
                        sourceType === "Sales Order"
                          ? "fill-violet-600"
                          : "fill-teal-500"
                      }
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    stroke="#ff7300"
                    strokeWidth={2}
                  />
                </BarChart>
              </ChartContainer>
            </Loading>
          </div>
        </CardContent>
      </Card>
    </>
  );
};
