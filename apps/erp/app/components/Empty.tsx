// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { useId } from "react";

export default function Empty({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <VStack
      className={cn("w-full h-full justify-center items-center", className)}
      {...props}
    >
      <EmptyCabinet className="shrink-0 text-foreground mb-4" />
      <h3 className="text-lg font-medium tracking-tight text-foreground">
        <Trans>No data yet</Trans>
      </h3>
      <p className="max-w-56 text-center text-xs text-muted-foreground text-balance">
        <Trans>
          Your data will appear here once you create or import your first
          records
        </Trans>
      </p>
      {children}
    </VStack>
  );
}

// An isometric filing cabinet whose bottom drawer slides open, empty.
// Faces are filled so nearer parts hide the lines behind them, which makes the
// element order (back to front) significant.
//
// The drawer is drawn last and slides along the cabinet's depth axis. The clip
// is everything left of the drawer opening's right edge and below its top edge:
// the part of the drawer still inside the cabinet always lands outside it, so
// the drawer disappears behind the cabinet front as it closes.
const DRAWER_CLOSED = { x: 26.2, y: -15.13 };

function EmptyCabinet({ className }: { className?: string }) {
  const clipId = useId();
  return (
    <svg
      width={94}
      height={124}
      viewBox="0 0 94 124"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth={0.6}
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <polygon points="60.3,76.3 -372.7,-173.7 -372.7,576.3 60.3,576.3" />
        </clipPath>
      </defs>
      <polygon
        className="fill-muted"
        points="84.87,98.56 90.19,95.49 90.19,91.94 84.87,95.01"
      />
      <polygon
        className="fill-background"
        points="79.55,95.49 84.87,98.56 84.87,95.01 79.55,91.94"
      />
      <polygon
        className="fill-muted"
        points="61.94,111.79 67.26,108.72 67.26,105.18 61.94,108.25"
      />
      <polygon
        className="fill-background"
        points="56.62,108.72 61.94,111.79 61.94,108.25 56.62,105.18"
      />
      <polygon
        className="fill-muted"
        points="34.51,95.96 39.84,92.89 39.84,89.34 34.51,92.41"
      />
      <polygon
        className="fill-background"
        points="29.19,92.89 34.51,95.96 34.51,92.41 29.19,89.34"
      />
      <polygon
        className="fill-muted"
        points="61.94,109.67 92.65,91.94 92.65,25.53 61.94,43.25"
      />
      <polygon
        className="fill-background"
        points="26.74,89.34 61.94,109.67 61.94,43.25 26.74,22.93"
      />
      <polygon
        className="fill-muted"
        points="61.94,43.73 93.05,25.76 93.05,21.51 61.94,39.47"
      />
      <polygon
        className="fill-background"
        points="26.33,23.16 61.94,43.73 61.94,39.47 26.33,18.91"
      />
      <polygon
        className="fill-background"
        points="26.33,18.91 61.94,39.47 93.05,21.51 57.44,0.95"
      />
      <polygon
        className="fill-background"
        points="60.22,40.61 60.19,40.32 60.08,40.02 59.92,39.74 59.71,39.50 59.49,39.33 59.26,39.24 59.05,39.24 58.89,39.34 58.79,39.51 58.75,39.75 58.79,40.04 58.89,40.34 59.05,40.62 59.26,40.86 59.49,41.03 59.71,41.12 59.92,41.12 60.08,41.02 60.19,40.85"
      />
      <polyline
        fill="none"
        strokeWidth={0.4}
        points="59.49,39.80 59.49,40.56"
      />
      <polygon
        className="fill-background"
        points="28.37,56.49 60.30,74.92 60.30,43.73 28.37,25.29"
      />
      <polygon
        className="fill-background"
        points="39.84,42.78 48.02,47.51 48.02,42.78 39.84,38.05"
      />
      <polygon
        className="fill-background"
        strokeWidth={0.4}
        points="40.55,42.37 47.31,46.27 47.31,43.19 40.55,39.29"
      />
      <polyline
        fill="none"
        strokeWidth={1.4}
        strokeLinecap="round"
        points="36.15,47.27 35.13,47.86 34.80,48.33 35.13,48.81 47,55.66 47.82,55.85 48.64,55.66 49.66,55.07"
      />
      <polyline
        className="stroke-background"
        fill="none"
        strokeWidth={0.6}
        strokeLinecap="round"
        points="36.15,47.27 35.13,47.86 34.80,48.33 35.13,48.81 47,55.66 47.82,55.85 48.64,55.66 49.66,55.07"
      />
      <polygon
        className="fill-muted"
        points="28.37,88.63 60.30,107.07 60.30,76.34 28.37,57.91"
      />
      <polyline
        fill="none"
        strokeWidth={0.4}
        points="28.37,88.63 54.98,73.27"
      />
      <g clipPath={`url(#${clipId})`}>
        <motion.g
          initial={DRAWER_CLOSED}
          animate={{ x: 0, y: 0 }}
          transition={{ delay: 0.3, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <polygon
            className="fill-muted"
            points="5.65,100.10 31.24,114.87 56.42,100.33 30.83,85.56"
          />
          <polygon
            className="fill-muted"
            points="5.65,100.10 30.83,85.56 30.83,67.71 5.65,82.25"
          />
          <polygon
            className="fill-background"
            points="30.83,85.56 56.42,100.33 56.42,82.49 30.83,67.71"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="4.63,82.25 5.14,82.55 31.34,67.42 30.83,67.12"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="30.32,67.42 56.93,82.78 57.44,82.49 30.83,67.12"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="30.73,97.32 31.24,97.61 57.44,82.49 56.93,82.19"
          />
          <polygon
            className="fill-muted"
            points="31.24,116.05 57.44,100.92 57.44,82.49 31.24,97.61"
          />
          <polygon
            className="fill-background"
            points="32.47,112.27 56.82,98.20 56.82,96.55 32.47,110.61"
          />
          <polygon
            className="fill-background"
            points="31.85,111.91 32.47,112.27 32.47,110.61 31.85,110.26"
          />
          <polygon
            className="fill-background"
            points="31.85,110.26 32.47,110.61 56.82,96.55 56.21,96.20"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="33.92,110.60 33.88,110.47 33.76,110.44 33.63,110.52 33.51,110.68 33.47,110.86 33.51,110.99 33.63,111.02 33.76,110.94 33.88,110.78"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="35.35,109.77 35.31,109.65 35.20,109.62 35.06,109.70 34.95,109.86 34.90,110.03 34.95,110.16 35.06,110.19 35.20,110.11 35.31,109.95"
          />
          <polygon
            className="fill-background"
            points="41.27,108.60 58.46,98.68 58.46,96.08 41.27,106"
          />
          <polygon
            className="fill-background"
            points="40.45,108.13 41.27,108.60 41.27,106 40.45,105.53"
          />
          <polygon
            className="fill-background"
            points="40.45,105.53 41.27,106 58.46,96.08 57.64,95.60"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="42.78,106.43 42.73,106.27 42.59,106.23 42.41,106.33 42.27,106.53 42.21,106.76 42.27,106.92 42.41,106.96 42.59,106.86 42.73,106.66"
          />
          <polygon
            className="fill-background"
            points="51.09,104.35 59.69,99.39 59.69,95.84 51.09,100.80"
          />
          <polygon
            className="fill-background"
            points="50.27,103.88 51.09,104.35 51.09,100.80 50.27,100.33"
          />
          <polygon
            className="fill-background"
            points="50.27,100.33 51.09,100.80 59.69,95.84 58.87,95.37"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="52.94,100.97 52.76,101.12 52.60,101.32 52.50,101.56 52.47,101.79 52.50,101.97 52.60,102.09 52.76,102.12 52.94,102.06 54.37,101.23 54.55,101.08 54.70,100.88 54.80,100.64 54.84,100.41 54.80,100.23 54.70,100.11 54.55,100.08 54.37,100.14"
          />
          <polygon
            className="fill-muted"
            points="32.88,122.90 34.10,122.19 34.10,92.18 32.88,92.89"
          />
          <polygon
            className="fill-background"
            points="0.95,104.47 32.88,122.90 32.88,92.89 0.95,74.45"
          />
          <polygon
            className="fill-background"
            points="0.95,74.45 32.88,92.89 34.10,92.18 2.17,73.74"
          />
          <polygon
            className="fill-background"
            points="12.41,91.94 20.60,96.67 20.60,91.94 12.41,87.21"
          />
          <polygon
            className="fill-background"
            strokeWidth={0.4}
            points="13.12,91.53 19.88,95.43 19.88,92.35 13.12,88.45"
          />
          <polyline
            fill="none"
            strokeWidth={1.4}
            strokeLinecap="round"
            points="8.72,96.43 7.70,97.02 7.37,97.50 7.70,97.97 19.57,104.82 20.39,105.01 21.21,104.82 22.23,104.23"
          />
          <polyline
            className="stroke-background"
            fill="none"
            strokeWidth={0.6}
            strokeLinecap="round"
            points="8.72,96.43 7.70,97.02 7.37,97.50 7.70,97.97 19.57,104.82 20.39,105.01 21.21,104.82 22.23,104.23"
          />
        </motion.g>
      </g>
    </svg>
  );
}
