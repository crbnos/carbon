import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Empty } from "~/components";
import type { TrendPayload } from "../dashboard.models";

const chartConfig = {
  value: { color: "hsl(var(--primary))" }
} satisfies ChartConfig;

export function TrendWidget({
  payload,
  formatValue
}: {
  payload: TrendPayload;
  formatValue: (value: number) => string;
}) {
  if (
    payload.points.length === 0 ||
    payload.points.every((p) => p.value === 0)
  ) {
    return <Empty className="h-40" />;
  }
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-40 w-full">
      <AreaChart data={payload.points} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel={false}
              formatter={(value) => formatValue(Number(value))}
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          fill="var(--color-value)"
          fillOpacity={0.15}
          stroke="var(--color-value)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
