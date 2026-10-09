// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IconButton
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuChartLine, LuX } from "react-icons/lu";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis
} from "recharts";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import type { BurnPoint } from "../../projects.models";

/**
 * The hours burn of one milestone: posted hours of its elements, added up day
 * by day, against the straight line to the planned hours on the end date.
 * Hours only; cost is not drawn.
 */
export function MilestoneBurnChart({
  name,
  series,
  plannedHours,
  today,
  onClose
}: {
  name: string;
  /** Empty when the milestone has no start or end date. */
  series: BurnPoint[];
  plannedHours: number;
  /** `YYYY-MM-DD` in the company's zone, for the today line. */
  today: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();

  const chartConfig = {
    actual: { color: "hsl(var(--chart-1))", label: t`Posted hours` },
    ideal: { color: "hsl(var(--muted-foreground))", label: t`Ideal` }
  } satisfies ChartConfig;

  const showsToday =
    series.length > 0 &&
    today >= series[0]!.date &&
    today <= series[series.length - 1]!.date;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="truncate">{name}</CardTitle>
          <CardDescription>
            <Trans>Hours burn · {formatQuantity(plannedHours)} planned</Trans>
          </CardDescription>
        </div>
        <IconButton
          aria-label={t`Close`}
          icon={<LuX />}
          variant="ghost"
          onClick={onClose}
        />
      </CardHeader>
      <CardContent>
        {series.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <LuChartLine className="size-6" />
            <Trans>
              Give the milestone a start and an end date to see its burn.
            </Trans>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-72 w-full">
            <LineChart accessibilityLayer data={series}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) =>
                  value ? formatDate(value as string) : ""
                }
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={48}
                tickFormatter={(value: number) => formatQuantity(value)}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => formatDate(String(value))}
                    formatter={(value, nameKey) => (
                      <span className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          {chartConfig[nameKey as keyof typeof chartConfig]
                            ?.label ?? String(nameKey)}
                        </span>
                        <span className="font-mono tabular-nums">
                          {formatQuantity(Number(value))}
                        </span>
                      </span>
                    )}
                  />
                }
              />
              <Line
                dataKey="ideal"
                type="linear"
                stroke="var(--color-ideal)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="actual"
                type="stepAfter"
                stroke="var(--color-actual)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {showsToday && (
                <ReferenceLine
                  x={today}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  label={{
                    value: t`Today`,
                    position: "insideTopLeft",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11
                  }}
                />
              )}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
