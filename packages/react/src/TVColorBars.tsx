import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { cn } from "./utils/cn";

// SMPTE color bars — the test pattern old TVs showed off-air. Used as a
// full-bleed backdrop on the ERP/MES error boundaries ("no signal").
//
// Geometry uses the real SMPTE proportions in a 21×12 grid (one top bar = 3
// units) so the three rows land exactly: bars 2/3 of the height, castellation
// strip 1/12, PLUGE row 1/4. `preserveAspectRatio="none"` stretches the grid
// to whatever box it's given, like a broadcast signal filling the screen.

// 75%-amplitude bars, left to right.
const BARS = [
  "#c0c0c0", // gray
  "#c0c000", // yellow
  "#00c0c0", // cyan
  "#00c000", // green
  "#c000c0", // magenta
  "#c00000", // red
  "#0000c0" // blue
];

// The thin reverse strip under the bars.
const CASTELLATIONS = [
  "#0000c0",
  "#131313",
  "#c000c0",
  "#131313",
  "#00c0c0",
  "#131313",
  "#c0c0c0"
];

// Bottom (PLUGE) row: -I, white, +Q, black, then the three near-black
// calibration strips, then black. Widths in 21-unit grid columns.
const PLUGE: { width: number; fill: string }[] = [
  { width: 3.75, fill: "#00214c" },
  { width: 3.75, fill: "#ffffff" },
  { width: 3.75, fill: "#32006a" },
  { width: 3.75, fill: "#131313" },
  { width: 1, fill: "#090909" },
  { width: 1, fill: "#131313" },
  { width: 1, fill: "#1d1d1d" },
  { width: 3, fill: "#131313" }
];

let plugeX = 0;
const PLUGE_RECTS = PLUGE.map(({ width, fill }) => {
  const x = plugeX;
  plugeX += width;
  return { x, width, fill };
});

export const TVColorBars = forwardRef<
  SVGSVGElement,
  ComponentPropsWithoutRef<"svg">
>(({ className, ...props }, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 21 12"
    preserveAspectRatio="none"
    shapeRendering="crispEdges"
    aria-hidden="true"
    className={cn(
      "pointer-events-none absolute inset-0 h-full w-full",
      className
    )}
    {...props}
  >
    {BARS.map((fill, i) => (
      <rect key={fill} x={i * 3} y={0} width={3} height={8} fill={fill} />
    ))}
    {CASTELLATIONS.map((fill, i) => (
      <rect key={i} x={i * 3} y={8} width={3} height={1} fill={fill} />
    ))}
    {PLUGE_RECTS.map(({ x, width, fill }) => (
      <rect key={x} x={x} y={9} width={width} height={3} fill={fill} />
    ))}
  </svg>
));
TVColorBars.displayName = "TVColorBars";
