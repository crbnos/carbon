import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Empty } from "~/components";
import type { BreakdownPayload } from "../dashboard.models";

const chartConfig = {
  value: { color: "hsl(var(--primary))" }
} satisfies ChartConfig;

export function BreakdownWidget({
  payload,
  formatValue
}: {
  payload: BreakdownPayload;
  formatValue: (value: number) => string;
}) {
  if (payload.rows.length === 0 || payload.rows.every((r) => r.value === 0)) {
    return <Empty className="h-40" />;
  }
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-40 w-full">
      <BarChart
        data={payload.rows}
        layout="vertical"
        margin={{ left: 4, right: 4 }}
      >
        <XAxis type="number" hide />
        <YAxis
          dataKey="name"
          type="category"
          width={120}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) => formatValue(Number(value))}
            />
          }
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
