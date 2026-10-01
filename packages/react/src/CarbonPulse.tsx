// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CSSProperties } from "react";
import { cn } from "./utils/cn";

const DEFAULT_SIZE = 72;
const DEFAULT_DURATION_MS = 2400;

type CarbonPulseProps = {
  // Relative paths resolve against the current app, which ships both marks in
  // its public/ folder. The light mark is the one drawn on light backgrounds.
  lightSrc?: string;
  darkSrc?: string;
  size?: number;
  durationMs?: number;
  label?: string;
  paused?: boolean;
  className?: string;
};

// A diagonal band, bottom-left to top-right. The mask is three times the
// element so the band can start and finish fully outside the mark.
const SWEEP_MASK: CSSProperties = {
  maskImage:
    "linear-gradient(45deg, transparent 42%, black 50%, transparent 58%)",
  WebkitMaskImage:
    "linear-gradient(45deg, transparent 42%, black 50%, transparent 58%)",
  maskSize: "300% 300%",
  WebkitMaskSize: "300% 300%",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat"
};

function Mark({
  lightSrc,
  darkSrc,
  className,
  style
}: {
  lightSrc: string;
  darkSrc: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cn("block size-full", className)} style={style}>
      <img
        src={lightSrc}
        alt=""
        draggable={false}
        className="size-full object-contain dark:hidden"
      />
      <img
        src={darkSrc}
        alt=""
        draggable={false}
        className="hidden size-full object-contain dark:block"
      />
    </span>
  );
}

// The Carbon mark sits dimmed while a band of light sweeps across it from the
// bottom-left to the top-right. The sweep reveals a full-strength copy of the
// mark through a moving mask, so the light only ever falls inside the logo.
// Keyframes live in packages/config/tailwind/theme.css.
export function CarbonPulse({
  lightSrc = "/carbon-mark-light.svg",
  darkSrc = "/carbon-mark-dark.svg",
  size = DEFAULT_SIZE,
  durationMs = DEFAULT_DURATION_MS,
  label = "Loading",
  paused = false,
  className
}: CarbonPulseProps) {
  const safeSize = Number.isFinite(size) && size > 0 ? size : DEFAULT_SIZE;
  const safeDuration =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : DEFAULT_DURATION_MS;

  const style = {
    width: safeSize,
    height: safeSize,
    "--carbon-pulse-duration": `${safeDuration}ms`
  } as CSSProperties;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("relative inline-flex shrink-0 select-none", className)}
      style={style}
    >
      <Mark
        lightSrc={lightSrc}
        darkSrc={darkSrc}
        className="opacity-25 motion-reduce:opacity-100"
      />
      <Mark
        lightSrc={lightSrc}
        darkSrc={darkSrc}
        className="absolute inset-0 animate-carbon-sweep motion-reduce:hidden"
        style={{
          ...SWEEP_MASK,
          animationPlayState: paused ? "paused" : "running"
        }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
