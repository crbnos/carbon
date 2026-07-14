// Display-only status for items the hub checks off automatically — their state
// derives from other checklists (Setup Map rows, plan tasks), so they are never
// tickable in place. Mirrors the ERP's operation-status icon language (the Bill
// of Process / job-operation icons): dashed circle = not started, ring with a
// proportional pie = in progress, check circle = done. Rendered as a plain span
// with the default cursor so it can't read as a checkbox; the tooltip says what
// actually completes it.

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { LuCircleCheck, LuCircleDashed } from "react-icons/lu";
import type { GateValue } from "../../types";

// Same construction as the ERP's status icons (assets/icons/*StatusIcon.tsx):
// an r=6 outer ring plus an r=2 pie stroked at width 4, filled to a fraction of
// the pie's circumference.
const PIE_CIRCUMFERENCE = 2 * Math.PI * 2;

function ProgressRingIcon({
  fraction,
  className
}: {
  fraction: number;
  className?: string;
}) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="7"
        cy="7"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeDasharray={`${clamped * PIE_CIRCUMFERENCE} 100`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

export function DerivedStatus({
  status,
  fraction,
  tooltip,
  className
}: {
  status: GateValue;
  // Portion of the underlying items already complete, for the in-progress pie.
  // Falls back to a half pie when the caller has no count.
  fraction?: number;
  tooltip: string;
  className?: string;
}) {
  const icon =
    status === "done" ? (
      <LuCircleCheck className="size-full text-emerald-600 dark:text-emerald-500" />
    ) : status === "prog" ? (
      // Blue, not theme primary — "in progress" is blue app-wide (the BoP
      // operation-status icons), and primary is near-black on neutral themes.
      <ProgressRingIcon
        fraction={fraction ?? 0.5}
        className="size-full text-blue-600 dark:text-blue-500"
      />
    ) : (
      <LuCircleDashed className="size-full text-muted-foreground" />
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={tooltip}
          className={cn(
            "shrink-0 inline-flex items-center justify-center cursor-default",
            className
          )}
        >
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
