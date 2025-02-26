import { Fragment, useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { Area } from "@visx/shape";
import { Text } from "@visx/text";
import { curveBasis } from "@visx/curve";
import { motion } from "framer-motion";
import { useIsMobile } from "./hooks";
import { cn } from "./utils/cn";

const layers = [
  {
    opacity: 1,
    padding: 0,
  },
  {
    opacity: 0.3,
    padding: 8,
  },
  {
    opacity: 0.15,
    padding: 16,
  },
];

const maxPadding = layers.reduce(
  (acc, layer) => Math.max(acc, layer.padding),
  0
);
const verticalPadding = 30;

interface FunnelStep {
  id: string;
  label: string;
  value: number;
  additionalValue?: number;
  colorClassName: string;
}

interface FunnelChartProps {
  steps: FunnelStep[];
  currencyFormatter: Intl.NumberFormat;
  numberFormatter: Intl.NumberFormat;
  persistentPercentages?: boolean;
  defaultTooltipStepId?: string;
  className?: string;
}

export function FunnelChart(props: FunnelChartProps) {
  return (
    <div className={props.className ?? "size-full"}>
      <ParentSize className="relative">
        {({ width, height }) =>
          width ? (
            <FunnelChartContent
              {...props}
              width={width}
              height={height || 420}
            />
          ) : null
        }
      </ParentSize>
    </div>
  );
}

interface FunnelChartContentProps extends FunnelChartProps {
  width: number;
  height: number;
}

function FunnelChartContent({
  width,
  height,
  steps,
  currencyFormatter,
  numberFormatter,
  persistentPercentages = true,
  defaultTooltipStepId,
}: FunnelChartContentProps) {
  const isMobile = useIsMobile();

  const [activeTooltip, setActiveTooltip] = useState<string | null>(
    defaultTooltipStepId ?? null
  );
  const activeStep = steps.find(({ id }) => id === activeTooltip);

  const funnelData = useMemo(() => {
    return Object.fromEntries(
      steps.map(({ id, value }, idx) => [
        id,
        generateCurvePoints(
          value,
          steps[idx + 1]?.value ?? steps[steps.length - 1].value
        ),
      ])
    );
  }, [steps]);

  const emptyData = useMemo(() => generateCurvePoints(0, 0), []);

  const highestValue = useMemo(
    () => Math.max(...steps.map((step) => step.value)),
    [steps]
  );

  const xScale = scaleLinear({
    domain: [0, steps.length],
    range: [0, width],
  });

  const yScale = scaleLinear({
    domain: [highestValue, -highestValue],
    range: [
      height - maxPadding - verticalPadding,
      maxPadding + verticalPadding,
    ],
  });

  return (
    <div className="relative">
      <svg width={width} height={height}>
        {steps.map(({ id, value, colorClassName }, idx) => {
          const stepCenterX = (xScale(idx) + xScale(idx + 1)) / 2;
          return (
            <Fragment key={id}>
              {/* Background interaction area */}
              <rect
                x={xScale(idx)}
                y={0}
                width={width / steps.length}
                height={height}
                className="fill-transparent transition-colors hover:fill-foreground/5"
                onPointerEnter={() => setActiveTooltip(id)}
                onPointerDown={() => setActiveTooltip(id)}
                onPointerLeave={() =>
                  !isMobile && setActiveTooltip(defaultTooltipStepId ?? null)
                }
              />

              {/* Vertical divider */}
              <line
                x1={xScale(idx)}
                y1={0}
                x2={xScale(idx)}
                y2={height}
                className="stroke-black/5 sm:stroke-black/10"
              />

              {/* Funnel visualization */}
              {layers.map(({ opacity, padding }) => (
                <Area
                  key={`${id}-${opacity}-${padding}`}
                  data={funnelData[id]}
                  curve={curveBasis}
                  x={(d) => xScale(idx + d.x)}
                  y0={(d) => yScale(-d.y) - padding}
                  y1={(d) => yScale(d.y) + padding}
                >
                  {({ path }) => {
                    return (
                      <motion.path
                        initial={{ d: path(emptyData) || "", opacity: 0 }}
                        animate={{ d: path(funnelData[id]) || "", opacity }}
                        className={cn(colorClassName, "pointer-events-none")}
                        fill="currentColor"
                      />
                    );
                  }}
                </Area>
              ))}

              {/* Percentage indicator */}
              {persistentPercentages && (
                <PercentageBadge
                  x={stepCenterX}
                  y={height / 2}
                  value={
                    value === 0
                      ? "0%"
                      : formatPercent(
                          (value / highestValue) * 100,
                          numberFormatter
                        ) + "%"
                  }
                  colorClassName={colorClassName}
                />
              )}
            </Fragment>
          );
        })}
      </svg>
      {activeStep && (
        <div
          key={activeStep.id}
          className={cn(
            "pointer-events-none absolute flex items-center justify-center px-1 pb-4",
            persistentPercentages
              ? "animate-slide-up-fade top-16 sm:top-12"
              : "animate-fade-in top-1/2 -translate-y-1/2"
          )}
          style={{
            left: xScale(steps.findIndex(({ id }) => id === activeStep.id)),
            width: width / steps.length,
          }}
        >
          <div
            className={cn(
              "rounded-lg border border-border bg-card text-base shadow-sm"
            )}
          >
            <p className="border-b border-border p-3 text-sm text-foreground">
              {activeStep.label}
            </p>
            <div className="flex flex-wrap justify-between gap-3 p-3 text-sm">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    activeStep.colorClassName,
                    "size-2 shrink-0 rounded-sm bg-current"
                  )}
                />
                <p className="whitespace-nowrap text-muted-foreground">
                  {activeStep.value === 0
                    ? "0%"
                    : formatPercent(
                        (activeStep.value / highestValue) * 100,
                        numberFormatter
                      ) + "%"}
                </p>
              </div>
              <p className="whitespace-nowrap text-foreground">
                {numberFormatter.format(activeStep.value)}
                {activeStep.additionalValue !== undefined && (
                  <span className="text-muted-foreground">
                    {" "}
                    {currencyFormatter.format(activeStep.additionalValue)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PercentageBadgeProps {
  x: number;
  y: number;
  value: string;
  colorClassName: string;
}

function PercentageBadge({
  x,
  y,
  value,
  colorClassName,
}: PercentageBadgeProps) {
  const textRef = useRef<SVGTextElement>(null);

  const textWidth = textRef.current?.getComputedTextLength() ?? 0;

  return (
    <g>
      <Text
        innerTextRef={textRef}
        x={x}
        y={y}
        width={textWidth}
        textAnchor="middle"
        verticalAnchor="middle"
        fontSize={14}
        className={cn(
          "pointer-events-none select-none font-medium fill-white",
          colorClassName
        )}
      >
        {value}
      </Text>
    </g>
  );
}

function formatPercent(
  value: number,
  numberFormatter: Intl.NumberFormat
): string {
  return value > 0 && value < 0.01 ? "< 0.01" : numberFormatter.format(value);
}

function generateCurvePoints(from: number, to: number) {
  return [
    { x: 0, y: from },
    { x: 0.3, y: from },
    { x: 0.5, y: (from + to) / 2 },
    { x: 0.7, y: to },
    { x: 1, y: to },
  ];
}
