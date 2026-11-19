// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "./utils/cn";

interface SpinnerProps {
  /** Diameter of the spinner in pixels */
  size?: number;
  className?: string;
  /**
   * Decorative: no status role or "Loading" text, for a spinner inside a
   * control that says it is busy itself (a loading Button sets `aria-busy`).
   */
  "aria-hidden"?: boolean;
}

const BARS = Array.from({ length: 12 });

export function Spinner({
  size = 16,
  className,
  "aria-hidden": ariaHidden
}: SpinnerProps) {
  const a11y = ariaHidden
    ? { "aria-hidden": true as const }
    : { role: "status", "aria-label": "Loading" };
  return (
    <div
      {...a11y}
      className={cn("relative inline-block", className)}
      style={{ width: size, height: size }}
    >
      {BARS.map((_, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-0 h-[24%] w-[8%] -translate-x-1/2 animate-spinner rounded-full bg-current"
          style={{
            transformOrigin: `center ${size / 2}px`,
            transform: `rotate(${i * 30}deg)`,
            animationDelay: `${-(11 - i) * (1 / 12)}s`
          }}
        />
      ))}
      {!ariaHidden && <span className="sr-only">Loading</span>}
    </div>
  );
}
