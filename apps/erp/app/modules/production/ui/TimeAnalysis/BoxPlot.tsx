// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { ChartContainer, ChartTooltip } from "@carbon/react/Chart";
import { RoundingMode, round } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { TimeDistribution } from "../../operation-time-analysis";

export function formatSeconds(seconds: number) {
  if (seconds < 10) return `${round(seconds, 1)}s`;
  if (seconds < 90) return `${round(seconds, 0)}s`;
  if (seconds < 5400) return `${round(seconds / 60, 1)}m`;
  return `${round(seconds / 3600, 1)}h`;
}

type Row = TimeDistribution & { whiskers: [number, number]; color: string };

export const seriesColor = (index: number) =>
  `hsl(var(--chart-${(index % 6) + 1}))`;

// recharts has no box plot. The bar spans the whiskers and this shape places
// every other mark inside it by interpolation.
function Box(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Row;
  selected?: string;
  onSelect?: (key: string) => void;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload, selected } = props;
  const { onSelect } = props;
  if (!payload) return null;
  const [low, high] = payload.whiskers;
  const at = (seconds: number) =>
    high === low ? y : y + (height * (high - seconds)) / (high - low);
  const center = x + width / 2;
  const half = Math.min(width, 72) / 2;
  const cap = half / 2;
  const dimmed = selected !== undefined && selected !== payload.key;

  return (
    <g
      className={cn("text-foreground", dimmed && "opacity-50")}
      stroke="currentColor"
      strokeWidth={1.5}
      {...(onSelect && {
        role: "button",
        tabIndex: 0,
        "aria-label": payload.label,
        "aria-pressed": selected === payload.key,
        onKeyDown: (event) =>
          (event.key === "Enter" || event.key === " ") && onSelect(payload.key)
      })}
    >
      <line x1={center} x2={center} y1={at(payload.max)} y2={at(payload.q3)} />
      <line x1={center} x2={center} y1={at(payload.q1)} y2={at(payload.min)} />
      {[payload.max, payload.min].map((whisker, i) => (
        <line
          key={i}
          x1={center - cap}
          x2={center + cap}
          y1={at(whisker)}
          y2={at(whisker)}
        />
      ))}
      <rect
        x={center - half}
        y={at(payload.q3)}
        width={half * 2}
        height={Math.max(at(payload.q1) - at(payload.q3), 1)}
        rx={2}
        fill={payload.color}
        fillOpacity={0.35}
        stroke={payload.color}
      />
      <line
        x1={center - half}
        x2={center + half}
        y1={at(payload.median)}
        y2={at(payload.median)}
        strokeDasharray="3 2"
      />
      <path
        d={`M${center - 3},${at(payload.mean) - 3}l6,6m0,-6l-6,6`}
        fill="none"
      />
      <text
        x={center}
        y={at(payload.max) - 8}
        textAnchor="middle"
        stroke="none"
        className="fill-muted-foreground text-[11px]"
      >
        {/* A narrow column has room for the count only; the tooltip has both. */}
        {payload.excluded > 0 && width >= 110 ? (
          <Trans>
            n = {payload.count}, {payload.excluded} excluded
          </Trans>
        ) : (
          <Trans>n = {payload.count}</Trans>
        )}
      </text>
    </g>
  );
}

function BoxTooltip({ payload }: { payload?: { payload: Row }[] }) {
  const row = payload?.[0]?.payload;
  if (!row) return null;
  const stats = [
    [<Trans key="max">Max</Trans>, row.max],
    [<Trans key="q3">75th</Trans>, row.q3],
    [<Trans key="median">Median</Trans>, row.median],
    [<Trans key="mean">Mean</Trans>, row.mean],
    [<Trans key="q1">25th</Trans>, row.q1],
    [<Trans key="min">Min</Trans>, row.min]
  ] as const;
  return (
    <div className="grid min-w-36 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{row.label}</span>
      {stats.map(([label, seconds], i) => (
        <div key={i} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono tabular-nums">
            {formatSeconds(seconds)}
          </span>
        </div>
      ))}
      <span className="text-muted-foreground">
        <Trans>
          n = {row.count}, {row.excluded} excluded
        </Trans>
      </span>
    </div>
  );
}

// Names wrap onto two lines and are cut to their column, so neighbours never
// overlap; the full name is the tick's title and the tooltip's heading.
function Tick(props: {
  x?: number;
  y?: number;
  width?: number;
  visibleTicksCount?: number;
  payload?: { value: string };
}) {
  const { x = 0, y = 0, width = 0, visibleTicksCount = 1, payload } = props;
  const label = payload?.value ?? "";
  // About 6.5px a character at this size.
  const fit = Math.max(
    round(width / visibleTicksCount / 6.5, 0, RoundingMode.Down),
    4
  );
  const lines = [""];
  for (const word of label.split(" ")) {
    const last = lines.length - 1;
    const joined = lines[last] ? `${lines[last]} ${word}` : word;
    if (!lines[last] || joined.length <= fit) lines[last] = joined;
    else lines.push(word);
  }

  return (
    <text x={x} y={y} textAnchor="middle" className="fill-muted-foreground">
      <title>{label}</title>
      {lines.slice(0, 2).map((line, i) => (
        <tspan key={i} x={x} dy={i ? 14 : 12}>
          {line.length > fit || (i === 1 && lines.length > 2)
            ? `${line.slice(0, fit - 1)}…`
            : line}
        </tspan>
      ))}
    </text>
  );
}

export function BoxPlot({
  data,
  selected,
  onSelect,
  color,
  className
}: {
  /** One colour for every box; without it each box gets its own. */
  color?: string;
  data: TimeDistribution[];
  selected?: string;
  onSelect?: (key: string) => void;
  className?: string;
}) {
  const rows: Row[] = data.map((row, i) => ({
    ...row,
    color: color ?? seriesColor(i),
    whiskers: [row.min, row.max]
  }));

  return (
    <ChartContainer
      config={{}}
      className={cn("aspect-auto h-72 w-full", className)}
    >
      <BarChart data={rows} margin={{ top: 24, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          height={40}
          tick={<Tick />}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={formatSeconds}
        />
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<BoxTooltip />} />
        <Bar
          dataKey="whiskers"
          isAnimationActive={false}
          shape={<Box selected={selected} onSelect={onSelect} />}
          // The whole column takes the click, not only the painted marks.
          background={onSelect ? { fill: "transparent" } : false}
          className={onSelect && "cursor-pointer"}
          onClick={onSelect && ((row: Row) => onSelect(row.key))}
        />
      </BarChart>
    </ChartContainer>
  );
}
