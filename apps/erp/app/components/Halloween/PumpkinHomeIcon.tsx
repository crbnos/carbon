// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import type { ReactNode } from "react";
import { useHalloweenDecorations } from "./season";

// The breadcrumbs' home icon, carved into a jack-o'-lantern for the season.
// Outside it, or once the user hides the decorations, the usual icon.

export function PumpkinHomeIcon({
  userId,
  fallback,
  className
}: {
  userId: string;
  fallback: ReactNode;
  className?: string;
}) {
  const shown = useHalloweenDecorations(userId);
  if (!shown) return fallback;
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn(
        "origin-bottom transition-transform duration-300 ease-out hover:-rotate-12",
        className
      )}
      aria-hidden
    >
      {/* Stem, curling off to one side */}
      <path
        d="M7.6 4.2 C7.5 3 7.9 2 9.1 1.4"
        fill="none"
        stroke="#5b7a2b"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      {/* The pumpkin: three lobes, the middle one in front */}
      <ellipse cx={4.9} cy={9.3} rx={3.9} ry={5} fill="#d9620f" />
      <ellipse cx={11.1} cy={9.3} rx={3.9} ry={5} fill="#d9620f" />
      <ellipse cx={8} cy={9.3} rx={4.1} ry={5.3} fill="#f47c1c" />
      {/* Carved face */}
      <g fill="#3a1a05">
        <path d="M4.9 8.6 L6.6 6.9 L7.1 9.1 Z" />
        <path d="M11.1 8.6 L9.4 6.9 L8.9 9.1 Z" />
        <path d="M4.5 10.4 Q8 13.8 11.5 10.4 L10.4 11.1 L9.8 10.5 L9 11.4 L8 10.7 L7 11.4 L6.2 10.5 L5.6 11.1 Z" />
      </g>
    </svg>
  );
}
