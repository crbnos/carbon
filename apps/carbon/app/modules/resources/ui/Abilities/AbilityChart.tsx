import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveNatural } from "@visx/curve";
import { Drag } from "@visx/drag";
import { LinearGradient } from "@visx/gradient";
import { GridColumns, GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { PatternLines } from "@visx/pattern";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { useRef } from "react";
import type { AbilityDatum } from "../../types";

type AbilityChartProps = {
  data: AbilityDatum[];
  shadowWeeks: number;
  parentHeight: number;
  parentWidth: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  onDataChange?: (data: AbilityDatum[]) => void;
};

const green = {
  300: "rgb(134 239 172)",
  500: "rgb(34 197 94)",
};

const zinc = {
  500: "rgb(113 113 122)",
  600: "rgb(82 82 91)",
};

const AbilityChart = ({
  data,
  shadowWeeks,
  parentHeight,
  parentWidth,
  margin = { top: 10, right: 20, bottom: 50, left: 40 },
  onDataChange,
}: AbilityChartProps) => {
  const svgRef = useRef<SVGSVGElement>(null);

  if (parentWidth < 50) return null;

  const width = parentWidth - margin.left - margin.right;
  const height = parentHeight - margin.top - margin.bottom;

  const condensed = height < 100;

  const x = (d: AbilityDatum) => d.week;
  const y = (d: AbilityDatum) => d.value;

  const lastDataPoint = data[data.length - 1];
  const maxValue = 100;

  const xScale = scaleLinear<number>({
    range: [0, width],
    domain: [0, x(lastDataPoint)],
  });

  const yScale = scaleLinear<number>({
    range: [height, 0],
    domain: [0, maxValue],
  });

  const interpolateAt = (week: number) => {
    // find the point on the data monotoneX curve that is closest to the given week
    const index = data.findIndex((d) => d.week >= week);
    const prev = data[index - 1];
    const next = data[index];
    if (!prev && !next) return 0;
    if (!prev) return next.value;
    if (!next) return prev.value;
    const ratio = (week - prev.week) / (next.week - prev.week);
    return prev.value + (next.value - prev.value) * ratio;
  };

  const shadowData: AbilityDatum[] = [
    ...data.filter((d) => d.week <= shadowWeeks),
    { week: shadowWeeks, value: interpolateAt(shadowWeeks) },
  ];

  return (
    <svg ref={svgRef} width={parentWidth} height={parentHeight}>
      <Group top={margin.top} left={margin.left}>
        {!condensed && (
          <>
            <GridRows
              scale={yScale}
              width={width}
              height={height}
              className="stroke-muted"
            />
            <GridColumns
              scale={xScale}
              width={width}
              height={height}
              className="stroke-muted"
            />
            <AxisBottom
              top={height}
              scale={xScale}
              numTicks={width > 520 ? 10 : 5}
            />
            <text
              x={xScale(lastDataPoint.week / 2) - 14}
              y={yScale(0) + 35}
              fontSize={10}
            >
              Week
            </text>

            <text x="-70" y="15" transform="rotate(-90)" fontSize={10}>
              Efficiency (%)
            </text>

            <LinearGradient
              id="fill"
              from={green[300]}
              to={zinc[500]}
              fromOpacity={0.2}
              toOpacity={0}
            />

            <PatternLines
              id="diagonalLines"
              height={6}
              width={6}
              stroke={`hsl(var(--muted-foreground))`}
              strokeWidth={1}
              orientation={["diagonal"]}
            />
            <AreaClosed
              stroke="transparent"
              data={data}
              yScale={yScale}
              x={(d) => xScale(x(d))}
              y={(d) => yScale(y(d))}
              fill="url(#fill)"
              curve={curveNatural}
            />

            <AreaClosed
              stroke="transparent"
              data={shadowData}
              yScale={yScale}
              x={(d) => xScale(x(d))}
              y={(d) => yScale(y(d))}
              fill="url(#diagonalLines)"
              curve={curveNatural}
            />
          </>
        )}
        <AxisLeft
          scale={yScale}
          numTicks={condensed ? 0 : undefined}
          hideTicks={condensed}
          axisClassName="text-muted-foreground"
        />
        <LinePath
          data={data}
          y={(d) => yScale(y(d))}
          x={(d) => xScale(x(d))}
          stroke={green[500]}
          strokeOpacity="0.8"
          strokeWidth={2}
          curve={curveNatural}
        />

        {!condensed &&
          data.map((d, index) => (
            <Drag
              key={`drag-${index}`}
              width={width}
              height={height}
              x={xScale(x(d))}
              y={yScale(y(d))}
              snapToPointer={false}
              restrict={
                index === data.length - 1
                  ? // The last point must be in the top right corner
                    {
                      xMin: xScale(lastDataPoint.week),
                      xMax: xScale(lastDataPoint.week),
                      yMin: yScale(maxValue),
                      yMax: yScale(maxValue),
                    }
                  : index === 0
                  ? // The first point must be at time 0, and less than the second point
                    {
                      xMin: xScale(0),
                      xMax: xScale(0),
                      yMin: yScale(data[index + 1].value),
                      yMax: yScale(0),
                    }
                  : // All other data must be between the previous and next point
                    {
                      xMin: xScale(data[index - 1].week),
                      xMax: xScale(data[index + 1].week),
                      yMin: yScale(data[index + 1].value),
                      yMax: yScale(data[index - 1].value),
                    }
              }
              onDragMove={({ dx, dy }) => {
                const newData = [...data];
                newData[index] = {
                  ...newData[index],
                  week: newData[index].week + xScale.invert(dx),
                  value: newData[index].value + yScale.invert(dy) - 100,
                };
                onDataChange?.(newData);
              }}
            >
              {({ dragStart, dragEnd, dragMove, isDragging, x, y, dx, dy }) => (
                <circle
                  key={`dot-${index}`}
                  cx={x}
                  cy={y}
                  r={isDragging ? 10 : 6}
                  transform={`translate(${dx}, ${dy})`}
                  fillOpacity={0.9}
                  strokeWidth={2}
                  onMouseMove={dragMove}
                  onMouseUp={dragEnd}
                  onMouseDown={dragStart}
                  onTouchStart={dragStart}
                  onTouchMove={dragMove}
                  onTouchEnd={dragEnd}
                  className="fill-emerald-400 stroke-emerald-600"
                />
              )}
            </Drag>
          ))}
      </Group>
    </svg>
  );
};

export default AbilityChart;
