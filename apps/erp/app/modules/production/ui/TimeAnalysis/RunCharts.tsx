// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ChartContainer, ChartTooltip } from "@carbon/react/Chart";
import { useDateFormatter } from "@react-aria/i18n";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis
} from "recharts";
import type { TimeDistribution, TimeRun } from "../../operation-time-analysis";
import { formatSeconds } from "./BoxPlot";

const axis = { tickLine: false, axisLine: false } as const;

/** Every run against the day it finished, with each method version's average dotted across its runs. */
export function RunScatter({
  runs,
  versions,
  from,
  to,
  color
}: {
  runs: TimeRun[];
  versions: TimeDistribution[];
  from: string;
  to: string;
  color: string;
}) {
  const day = useDateFormatter({ month: "short", day: "numeric" });
  const points = runs.map((run) => ({ ...run, time: Date.parse(run.endedAt) }));
  // Runs arrive oldest first, so a version's span is its first and last point.
  const spans = new Map<number, [number, number]>();
  for (const { version, time } of points) {
    spans.set(version, [spans.get(version)?.[0] ?? time, time]);
  }

  return (
    <ChartContainer config={{}} className="aspect-auto h-72 w-full">
      <ScatterChart margin={{ top: 24, right: 16 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          {...axis}
          dataKey="time"
          type="number"
          scale="time"
          domain={[Date.parse(from), Date.parse(to)]}
          tickFormatter={(time: number) => day.format(new Date(time))}
        />
        <YAxis
          {...axis}
          dataKey="seconds"
          type="number"
          width={64}
          tickFormatter={formatSeconds}
        />
        <ChartTooltip
          cursor={false}
          content={({ payload }) => {
            const run = payload?.[0]?.payload as (typeof points)[number];
            return run ? (
              <div className="grid gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <span className="font-medium">
                  {run.jobReadableId} · V{run.version}
                </span>
                <span className="text-muted-foreground">
                  {day.format(new Date(run.time))}
                </span>
                <span className="font-mono">{formatSeconds(run.seconds)}</span>
              </div>
            ) : null;
          }}
        />
        <Scatter data={points} fill={color} isAnimationActive={false}>
          {points.map((run, i) => (
            <Cell key={i} fillOpacity={run.outlier ? 0.35 : 0.9} />
          ))}
        </Scatter>
        {versions.map((version) => {
          const span = spans.get(version.version);
          return (
            span && (
              <ReferenceLine
                key={version.key}
                segment={[
                  { x: span[0], y: version.mean },
                  { x: span[1], y: version.mean }
                ]}
                stroke="currentColor"
                strokeDasharray="5 4"
                ifOverflow="extendDomain"
                label={{
                  value: `${version.label} ${formatSeconds(version.mean)}`,
                  position: "top"
                }}
              />
            )
          );
        })}
      </ScatterChart>
    </ChartContainer>
  );
}

/** How many runs took how long. The bar holding the average is solid. */
export function RunHistogram({
  runs,
  mean,
  color
}: {
  runs: TimeRun[];
  mean: number;
  color: string;
}) {
  if (runs.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const { seconds } of runs) {
    low = Math.min(low, seconds);
    high = Math.max(high, seconds);
  }
  // Sturges' rule.
  const count = Math.ceil(Math.log2(runs.length)) + 1;
  const width = (high - low) / count || 1;
  const bin = (seconds: number) =>
    Math.min(Math.floor((seconds - low) / width), count - 1);
  const bins = Array.from({ length: count }, (_, i) => ({
    label: `${formatSeconds(low + i * width)} – ${formatSeconds(low + (i + 1) * width)}`,
    runs: 0
  }));
  for (const { seconds } of runs) bins[bin(seconds)]!.runs++;

  return (
    <ChartContainer config={{}} className="aspect-auto h-72 w-full">
      <BarChart data={bins} margin={{ top: 24, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis {...axis} dataKey="label" />
        <YAxis {...axis} width={32} allowDecimals={false} />
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} />
        <Bar dataKey="runs" fill={color} radius={2} isAnimationActive={false}>
          {bins.map((_, i) => (
            <Cell key={i} fillOpacity={i === bin(mean) ? 1 : 0.45} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
