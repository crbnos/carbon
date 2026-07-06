import type { CSSProperties } from "react";

// Bar heights trace a hexagon silhouette: short at the ends, tallest in the
// middle. Each bar shimmers between `min` and `peak`, with a staggered delay so
// a wave travels across while the hexagon stays visible the whole time.
const BARS = [
  { peak: 24, min: 11 },
  { peak: 47, min: 21 },
  { peak: 70, min: 32 },
  { peak: 80, min: 36 },
  { peak: 70, min: 32 },
  { peak: 47, min: 21 },
  { peak: 24, min: 11 }
];

export function LoadingBars() {
  return (
    <div className="flex items-center justify-center gap-[3px] h-20">
      {BARS.map((bar, i) => (
        <div
          key={i}
          className="w-[9px] rounded-[2px] bg-primary"
          style={
            {
              height: bar.min,
              animationName: "loading-bars",
              animationDuration: "1.2s",
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationDelay: `${i * 0.1}s`,
              "--peak": `${bar.peak}px`,
              "--min": `${bar.min}px`
            } as CSSProperties
          }
        />
      ))}
      <style>
        {`@keyframes loading-bars {
              0%, 100% { height: var(--min); opacity: 0.4; }
              50% { height: var(--peak); opacity: 1; }
            }`}
      </style>
    </div>
  );
}
