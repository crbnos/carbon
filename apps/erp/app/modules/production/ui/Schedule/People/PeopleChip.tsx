import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import type { ReactNode } from "react";

/**
 * The people page uses two badge shapes on purpose, and the difference is what
 * the COLOUR means:
 *
 * - `PeopleChip` (grid) — colour identifies the WORK CENTER, so the same station
 *   reads the same all the way down a week column. Callers pass the class.
 * - `PeoplePill` (card) — colour identifies the METRIC (hours / free / overtime /
 *   absent), so a caller picks a semantic `tone` instead.
 *
 * Merging them would force one of those meanings onto the other.
 */

function withTooltip(node: ReactNode, tooltip?: string) {
  if (!tooltip) return <>{node}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

const CHIP_BASE =
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-black/5 dark:ring-white/10";

/** Matrix / Capacity grid chip. `className` carries the colour. */
export function PeopleChip({
  className,
  tooltip,
  children
}: {
  className?: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return withTooltip(
    <span className={cn(CHIP_BASE, className)}>{children}</span>,
    tooltip
  );
}

export const PILL_TONES = {
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  red: "bg-red-500/15 text-red-700 dark:text-red-400"
} as const;

/** People card stat pill. Pass `tooltip` to explain what the number means —
 * the pills are terse by design, so the explanation lives on hover. */
export function PeoplePill({
  tone,
  tooltip,
  children
}: {
  tone: keyof typeof PILL_TONES;
  tooltip?: string;
  children: ReactNode;
}) {
  return withTooltip(
    <span
      className={cn(
        "inline-flex items-center rounded-xl px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        PILL_TONES[tone]
      )}
    >
      {children}
    </span>,
    tooltip
  );
}
